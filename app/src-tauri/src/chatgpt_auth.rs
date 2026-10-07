use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::{fs, path::PathBuf, sync::Arc, time::{SystemTime, UNIX_EPOCH}};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;
use url::Url;

const AUTHORIZE_URL: &str = "https://auth.openai.com/api/accounts/authorize";
const TOKEN_URL: &str = "https://auth.openai.com/api/accounts/oauth/token";
const RESOURCE: &str = "https://api.openai.com/v1";
const DISCOVERY_URL: &str = "https://auth.openai.com/.well-known/openid-configuration";
const APP_NAME: &str = "Project Graph PG1.1";

#[derive(Default)]
pub struct ChatGPTLock(pub Arc<Mutex<()>>);

#[derive(Default)]
pub struct StreamRegistry(pub Arc<std::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>>);

struct StreamCleanup {
    request_id: String,
    registry: Arc<std::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>>,
}

impl Drop for StreamCleanup {
    fn drop(&mut self) {
        if let Ok(mut registry) = self.registry.lock() { registry.remove(&self.request_id); }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGPTConnectionStatus {
    connected: bool,
    email: Option<String>,
    has_plan_access: bool,
}

#[derive(Clone, Serialize)]
pub struct AccountModel {
    slug: String,
    display_name: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct StoredCredential {
    client_id: String,
    host_id: String,
    subject: String,
    email: Option<String>,
    id_token: String,
    access_token: String,
    refresh_token: String,
    scopes: Vec<String>,
    expires_at: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
    expires_in: u64,
    scope: Option<String>,
}

#[derive(Deserialize)]
struct OidcConfiguration {
    issuer: String,
    jwks_uri: String,
    revocation_endpoint: Option<String>,
}

#[derive(Deserialize)]
struct IdClaims {
    sub: String,
    email: Option<String>,
    nonce: String,
}

#[derive(Deserialize)]
struct ModelCatalog {
    models: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    slug: String,
    display_name: String,
    visibility: String,
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    client_id: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub async fn chatgpt_connection_status(app: AppHandle, lock: State<'_, ChatGPTLock>) -> Result<ChatGPTConnectionStatus, String> {
    let _guard = lock.0.lock().await;
    connection_status(&app).await
}

async fn connection_status(app: &AppHandle) -> Result<ChatGPTConnectionStatus, String> {
    let Some(credential) = read_credential(&app)? else {
        return Ok(ChatGPTConnectionStatus { connected: false, email: None, has_plan_access: false });
    };
    let mut credential = credential;
    refresh_if_needed(app, &mut credential).await?;
    let has_plan_access = credential.scopes.iter().any(|scope| scope == "chatgpt.tokens.use.direct");
    Ok(ChatGPTConnectionStatus {
        connected: credential.expires_at > now_seconds(),
        email: credential.email,
        has_plan_access,
    })
}

#[tauri::command]
pub async fn chatgpt_start_login(app: AppHandle, lock: State<'_, ChatGPTLock>) -> Result<ChatGPTConnectionStatus, String> {
    let _guard = lock.0.lock().await;
    let existing = read_credential(&app)?;
    let client_id = existing.as_ref().map(|credential| credential.client_id.clone()).unwrap_or_else(|| "dynamic_agent_client".into());
    let host_id = existing.as_ref().map(|credential| credential.host_id.clone()).unwrap_or_else(new_host_id);
    let state = random_url_token(32);
    let nonce = random_url_token(32);
    let verifier = random_url_token(48);
    let challenge = base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, sha2::Sha256::digest(verifier.as_bytes()));
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|error| format!("无法启动本地授权回调：{error}"))?;
    let port = listener.local_addr().map_err(|error| error.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/auth/callback");

    let mut authorize = Url::parse(AUTHORIZE_URL).map_err(|error| error.to_string())?;
    {
        let mut query = authorize.query_pairs_mut();
        query.append_pair("client_id", &client_id);
        if existing.is_none() { query.append_pair("agent_name_hint", APP_NAME); }
        query.append_pair("ext_agent_host_id", &host_id);
        if let Some(credential) = &existing { query.append_pair("id_token_hint", &credential.id_token); }
        query.append_pair("response_type", "code");
        query.append_pair("redirect_uri", &redirect_uri);
        query.append_pair("scope", "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct");
        query.append_pair("resource", RESOURCE);
        query.append_pair("state", &state);
        query.append_pair("nonce", &nonce);
        query.append_pair("code_challenge_method", "S256");
        query.append_pair("code_challenge", &challenge);
    }

    let callback_state = state.clone();
    let callback_task = tokio::task::spawn_blocking(move || receive_callback(listener, &callback_state));
    app.shell().open(authorize.as_str(), None).map_err(|error| format!("无法打开系统浏览器：{error}"))?;
    let callback = callback_task.await.map_err(|error| format!("授权回调失败：{error}"))??;
    if callback.error.as_deref() == Some("access_denied") { return Err("你取消了 ChatGPT 授权。".into()); }
    if callback.state.as_deref() != Some(state.as_str()) { return Err("ChatGPT 授权状态校验失败。".into()); }
    let code = callback.code.ok_or_else(|| "授权回调中没有授权码。".to_string())?;
    let issued_client_id = if client_id == "dynamic_agent_client" {
        callback.client_id.filter(|id| !id.trim().is_empty() && id != "dynamic_agent_client").ok_or_else(|| "OpenAI 没有返回已注册的客户端 ID，授权未完成。".to_string())?
    } else {
        if callback.client_id.as_deref().is_some_and(|id| id != client_id) { return Err("OpenAI 返回的客户端与当前账号不匹配。".into()); }
        client_id
    };

    let token: TokenResponse = reqwest::Client::new().post(TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", issued_client_id.as_str()),
            ("code", code.as_str()),
            ("code_verifier", verifier.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("resource", RESOURCE),
        ])
        .send().await.map_err(|error| format!("OpenAI 授权失败：{error}"))?
        .error_for_status().map_err(|error| format!("OpenAI 授权失败：{error}"))?
        .json().await.map_err(|error| format!("无法读取 OpenAI 授权结果：{error}"))?;

    let scopes = token.scope.as_deref().unwrap_or_default().split_whitespace().map(str::to_string).collect::<Vec<_>>();
    if !scopes.iter().any(|scope| scope == "chatgpt.tokens.use.direct") {
        return Err("ChatGPT 登录成功，但账号没有授权套餐请求权限。请重新登录并在 OpenAI 页面允许该权限。".into());
    }
    let id_token = token.id_token.ok_or_else(|| "OpenAI 授权结果缺少身份令牌。".to_string())?;
    let (subject, email) = validate_id_token(&id_token, &issued_client_id, &nonce).await?;
    if existing.as_ref().is_some_and(|saved| saved.subject != subject) { return Err("授权账号与当前已选账号不一致，现有连接未更改。".into()); }
    write_credential(&app, &StoredCredential {
        client_id: issued_client_id,
        host_id,
        subject,
        email,
        id_token,
        access_token: token.access_token,
        refresh_token: token.refresh_token.ok_or_else(|| "OpenAI 授权结果缺少刷新令牌。".to_string())?,
        scopes,
        expires_at: now_seconds().saturating_add(token.expires_in),
    })?;
    Ok(ChatGPTConnectionStatus { connected: true, email: read_credential(&app)?.and_then(|credential| credential.email), has_plan_access: true })
}

#[tauri::command]
pub async fn chatgpt_disconnect(app: AppHandle, lock: State<'_, ChatGPTLock>) -> Result<(), String> {
    let _guard = lock.0.lock().await;
    let Some(credential) = read_credential(&app)? else { return Ok(()); };
    let discovery = reqwest::Client::new().get(DISCOVERY_URL).send().await;
    let revoke_result = match discovery {
        Ok(response) => match response.error_for_status().and_then(|response| Ok(response)) {
            Ok(response) => match response.json::<OidcConfiguration>().await {
                Ok(config) => if let Some(endpoint) = config.revocation_endpoint {
                    match reqwest::Client::new().post(endpoint).form(&[
                        ("token", credential.refresh_token.as_str()),
                        ("token_type_hint", "refresh_token"),
                        ("client_id", credential.client_id.as_str()),
                    ]).send().await {
                        Ok(response) => response.error_for_status().map(|_| ()).map_err(|error| format!("OpenAI 会话撤销失败：{error}")),
                        Err(error) => Err(format!("OpenAI 会话撤销失败：{error}")),
                    }
                } else { Ok(()) },
                Err(error) => Err(format!("无法读取 OpenAI 会话配置：{error}")),
            },
            Err(error) => Err(format!("无法确认 OpenAI 会话撤销状态：{error}")),
        },
        Err(error) => Err(format!("无法确认 OpenAI 会话撤销状态：{error}")),
    };
    clear_credential(&app)?;
    revoke_result.map_err(|error| format!("本机连接已清除，但 OpenAI 远端会话撤销未确认。可在 ChatGPT 设置中断开 Project Graph。{error}"))
}

#[tauri::command]
pub async fn chatgpt_list_models(app: AppHandle, lock: State<'_, ChatGPTLock>) -> Result<Vec<AccountModel>, String> {
    let _guard = lock.0.lock().await;
    let mut credential = read_credential(&app)?.ok_or_else(|| "ChatGPT 尚未连接。".to_string())?;
    refresh_if_needed(&app, &mut credential).await?;
    let response = reqwest::Client::new().get(format!("{RESOURCE}/models")).bearer_auth(&credential.access_token).send().await
        .map_err(|error| format!("读取 ChatGPT 模型列表失败：{error}"))?
        .error_for_status().map_err(|error| format!("读取 ChatGPT 模型列表失败：{error}"))?
        .json::<ModelCatalog>().await.map_err(|error| format!("读取 ChatGPT 模型列表失败：{error}"))?;
    Ok(response.models.into_iter().filter(|model| model.visibility == "list")
        .map(|model| AccountModel { slug: model.slug, display_name: model.display_name }).collect())
}

#[tauri::command]
pub async fn chatgpt_stream_chat_completion(
    app: AppHandle,
    lock: State<'_, ChatGPTLock>,
    registry: State<'_, StreamRegistry>,
    request_body: serde_json::Value,
    request_id: String,
    channel: Channel<String>,
) -> Result<(), String> {
    let _guard = lock.0.lock().await;
    let mut credential = read_credential(&app)?.ok_or_else(|| "ChatGPT 尚未连接，请先登录。".to_string())?;
    refresh_if_needed(&app, &mut credential).await?;
    let request_body = to_responses_request(&request_body, true)?;
    let response = reqwest::Client::new().post(format!("{RESOURCE}/responses"))
        .bearer_auth(&credential.access_token).json(&request_body).send().await
        .map_err(|error| format!("ChatGPT 请求失败：{error}"))?;
    let response = response.error_for_status().map_err(|error| format!("ChatGPT 请求失败：{error}"))?;
    let (cancel_sender, mut cancel_receiver) = tokio::sync::oneshot::channel();
    registry.0.lock().map_err(|_| "ChatGPT 请求状态不可用。".to_string())?.insert(request_id.clone(), cancel_sender);
    let _cleanup = StreamCleanup { request_id: request_id.clone(), registry: Arc::clone(&registry.0) };
    let mut state = StreamState::default();
    let mut pending = String::new();
    let mut response = response;
    loop {
        let chunk = tokio::select! {
            _ = &mut cancel_receiver => return Err("ChatGPT 请求已取消。".into()),
            chunk = response.chunk() => chunk.map_err(|error| format!("ChatGPT 流式请求中断：{error}"))?,
        };
        let Some(chunk) = chunk else { break; };
        pending.push_str(&String::from_utf8_lossy(&chunk));
        pending = pending.replace("\r\n", "\n");
        while let Some(end) = pending.find("\n\n") {
            let event = pending.drain(..end + 2).collect::<String>();
            for line in event.lines().filter_map(|line| line.strip_prefix("data:")) {
                let data = line.trim();
                if data == "[DONE]" { continue; }
                let value: serde_json::Value = serde_json::from_str(data).map_err(|_| "ChatGPT 返回了无法识别的流事件。".to_string())?;
                state.handle_event(&channel, &value, request_body["model"].as_str().unwrap_or(""))?;
            }
        }
    }
    if !state.completed { return Err("ChatGPT 流结束时没有收到完成确认。".into()); }
    Ok(())
}

#[tauri::command]
pub async fn chatgpt_cancel_stream(registry: State<'_, StreamRegistry>, request_id: String) -> Result<(), String> {
    if let Some(cancel) = registry.0.lock().map_err(|_| "ChatGPT 请求状态不可用。".to_string())?.remove(&request_id) {
        let _ = cancel.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn chatgpt_generate_chat_completion(
    app: AppHandle,
    lock: State<'_, ChatGPTLock>,
    request_body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let _guard = lock.0.lock().await;
    let mut credential = read_credential(&app)?.ok_or_else(|| "ChatGPT 尚未连接，请先登录。".to_string())?;
    refresh_if_needed(&app, &mut credential).await?;
    let request_body = to_responses_request(&request_body, true)?;
    let mut response = reqwest::Client::new().post(format!("{RESOURCE}/responses"))
        .bearer_auth(&credential.access_token).json(&request_body).send().await
        .map_err(|error| format!("ChatGPT 请求失败：{error}"))?
        .error_for_status().map_err(|error| format!("ChatGPT 请求失败：{error}"))?;
    let mut pending = String::new();
    let mut text = String::new();
    let mut response_id = String::new();
    let mut model = request_body["model"].as_str().unwrap_or_default().to_string();
    let mut usage = serde_json::Value::Null;
    let mut completed = false;
    while let Some(chunk) = response.chunk().await.map_err(|error| format!("ChatGPT 流式请求中断：{error}"))? {
        pending.push_str(&String::from_utf8_lossy(&chunk));
        pending = pending.replace("\r\n", "\n");
        while let Some(end) = pending.find("\n\n") {
            let event = pending.drain(..end + 2).collect::<String>();
            for line in event.lines().filter_map(|line| line.strip_prefix("data:")) {
                let data = line.trim();
                if data == "[DONE]" { continue; }
                let value: serde_json::Value = serde_json::from_str(data).map_err(|_| "ChatGPT 返回了无法识别的流事件。".to_string())?;
                match value["type"].as_str().unwrap_or_default() {
                    "response.output_text.delta" => text.push_str(value["delta"].as_str().unwrap_or_default()),
                    "response.completed" => {
                        completed = true;
                        response_id = value["response"]["id"].as_str().unwrap_or_default().to_string();
                        model = value["response"]["model"].as_str().unwrap_or(&model).to_string();
                        usage = serde_json::json!({
                            "prompt_tokens":value["response"]["usage"]["input_tokens"],
                            "completion_tokens":value["response"]["usage"]["output_tokens"],
                            "total_tokens":value["response"]["usage"]["total_tokens"]
                        });
                    }
                    "response.failed" | "response.incomplete" | "error" => return Err(format!("ChatGPT 返回错误：{}", value["response"]["error"]["message"].as_str().unwrap_or("请求未完成"))),
                    _ => {}
                }
            }
        }
    }
    if !completed { return Err("ChatGPT 流结束时没有收到完成确认。".into()); }
    Ok(serde_json::json!({
        "id":response_id,"object":"chat.completion","created":now_seconds(),"model":model,
        "choices":[{"index":0,"message":{"role":"assistant","content":text},"finish_reason":"stop"}],
        "usage":usage
    }))
}

#[derive(Default)]
struct StreamState {
    response_id: String,
    completed: bool,
    finish_reason: String,
    tools: std::collections::HashMap<usize, usize>,
    next_tool_index: usize,
}

impl StreamState {
    fn emit(&self, channel: &Channel<String>, chunk: serde_json::Value) -> Result<(), String> {
        channel.send(format!("data: {}\n\n", chunk)).map_err(|error| format!("无法传递 ChatGPT 回答：{error}"))
    }

    fn emit_delta(&self, channel: &Channel<String>, model: &str, delta: serde_json::Value) -> Result<(), String> {
        self.emit(channel, serde_json::json!({"id":self.response_id,"object":"chat.completion.chunk","created":now_seconds(),"model":model,"choices":[{"index":0,"delta":delta,"finish_reason":null}]}))
    }

    fn handle_event(&mut self, channel: &Channel<String>, event: &serde_json::Value, model: &str) -> Result<(), String> {
        match event["type"].as_str().unwrap_or_default() {
            "response.created" => self.response_id = event["response"]["id"].as_str().unwrap_or("chatcmpl-pg11").to_string(),
            "response.output_text.delta" => self.emit_delta(channel, model, serde_json::json!({"content":event["delta"]}))?,
            "response.output_item.added" if event["item"]["type"] == "function_call" => {
                let output_index = event["output_index"].as_u64().unwrap_or(0) as usize;
                let index = self.next_tool_index;
                self.next_tool_index += 1;
                self.tools.insert(output_index, index);
                self.finish_reason = "tool_calls".into();
                self.emit_delta(channel, model, serde_json::json!({"tool_calls":[{"index":index,"id":event["item"]["call_id"],"type":"function","function":{"name":event["item"]["name"],"arguments":""}}]}))?;
            }
            "response.function_call_arguments.delta" => {
                let output_index = event["output_index"].as_u64().unwrap_or(0) as usize;
                if let Some(index) = self.tools.get(&output_index) {
                    self.emit_delta(channel, model, serde_json::json!({"tool_calls":[{"index":index,"function":{"arguments":event["delta"]}}]}))?;
                }
            }
            "response.completed" => {
                self.completed = true;
                let response = &event["response"];
                let reason = if self.finish_reason.is_empty() { "stop" } else { &self.finish_reason };
                self.emit(channel, serde_json::json!({"id":self.response_id,"object":"chat.completion.chunk","created":now_seconds(),"model":model,"choices":[{"index":0,"delta":{},"finish_reason":reason}],"usage":{"prompt_tokens":response["usage"]["input_tokens"],"completion_tokens":response["usage"]["output_tokens"],"total_tokens":response["usage"]["total_tokens"]}}))?;
                channel.send("data: [DONE]\n\n".to_string()).map_err(|error| format!("无法结束 ChatGPT 回答：{error}"))?;
            }
            "response.failed" | "response.incomplete" | "error" => return Err(format!("ChatGPT 返回错误：{}", event["response"]["error"]["message"].as_str().unwrap_or("请求未完成"))),
            _ => {}
        }
        Ok(())
    }
}

fn to_responses_request(chat: &serde_json::Value, stream: bool) -> Result<serde_json::Value, String> {
    let model = chat["model"].as_str().ok_or_else(|| "ChatGPT 模型未选择。".to_string())?;
    let mut instructions = Vec::new();
    let mut input = Vec::new();
    if let Some(messages) = chat["messages"].as_array() {
        for message in messages {
            let role = message["role"].as_str().unwrap_or("user");
            let content = chat_message_text(&message["content"])?;
            match role {
                "system" => { if !content.is_empty() { instructions.push(content); } },
                "developer" | "user" => {
                    if !content.is_empty() { input.push(serde_json::json!({"type":"message","role":role,"content":[{"type":if role=="user"{"input_text"}else{"input_text"},"text":content}]})); }
                }
                "assistant" => {
                    if !content.is_empty() { input.push(serde_json::json!({"type":"message","role":"assistant","content":[{"type":"output_text","text":content}]})); }
                    if let Some(calls) = message["tool_calls"].as_array() {
                        for call in calls {
                            if call["type"].as_str().unwrap_or("function") != "function" { return Err("ChatGPT 套餐模式只支持函数工具。".into()); }
                            input.push(serde_json::json!({"type":"function_call","call_id":call["id"],"name":call["function"]["name"],"arguments":call["function"]["arguments"]}));
                        }
                    }
                }
                "tool" => input.push(serde_json::json!({"type":"function_call_output","call_id":message["tool_call_id"],"output":content})),
                _ => return Err(format!("ChatGPT 套餐模式不支持消息角色：{role}")),
            }
        }
    }
    let mut request = serde_json::json!({"model":model,"input":input,"store":false,"stream":stream});
    if !instructions.is_empty() { request["instructions"] = serde_json::Value::String(instructions.join("\n\n")); }
    if let Some(tools) = chat["tools"].as_array() {
        let mut converted = Vec::new();
        for tool in tools {
            if tool["type"].as_str() != Some("function") { return Err("ChatGPT 套餐模式不支持此类托管工具。".into()); }
            let function = &tool["function"];
            converted.push(serde_json::json!({"type":"function","name":function["name"],"description":function["description"],"parameters":function["parameters"],"strict":function["strict"]}));
        }
        request["tools"] = serde_json::Value::Array(converted);
    }
    if let Some(choice) = chat.get("tool_choice") {
        request["tool_choice"] = if choice.is_object() && choice["type"] == "function" {
            serde_json::json!({"type":"function","name":choice["function"]["name"]})
        } else { choice.clone() };
    }
    Ok(request)
}

fn chat_message_text(content: &serde_json::Value) -> Result<String, String> {
    if let Some(text) = content.as_str() { return Ok(text.to_string()); }
    let Some(parts) = content.as_array() else { return Ok(String::new()); };
    let mut text = Vec::new();
    for part in parts {
        if part["type"].as_str().is_some_and(|kind| kind == "text" || kind == "input_text") {
            if let Some(value) = part["text"].as_str() { text.push(value); }
        } else {
            return Err("ChatGPT 套餐模式目前只支持纯文本对话输入。".into());
        }
    }
    Ok(text.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::to_responses_request;
    use serde_json::json;

    #[test]
    fn chat_history_uses_responses_shape_without_persisted_state() {
        let request = to_responses_request(&json!({
            "model":"account-model",
            "messages":[
                {"role":"system","content":"instructions"},
                {"role":"user","content":"question"},
                {"role":"assistant","content":"answer"},
                {"role":"assistant","content":null,"tool_calls":[{"id":"call-1","type":"function","function":{"name":"inspect","arguments":"{}"}}]},
                {"role":"tool","tool_call_id":"call-1","content":"done"}
            ],
            "tools":[{"type":"function","function":{"name":"inspect","description":"inspect object","parameters":{"type":"object"}}}],
            "temperature":0.2,
            "max_tokens":100
        }), true).unwrap();

        assert_eq!(request["store"], false);
        assert_eq!(request["stream"], true);
        assert_eq!(request["instructions"], "instructions");
        assert_eq!(request["input"].as_array().unwrap().len(), 4);
        assert_eq!(request["input"][2]["type"], "function_call");
        assert_eq!(request["input"][3]["type"], "function_call_output");
        assert!(request.get("temperature").is_none());
        assert!(request.get("max_tokens").is_none());
    }

    #[test]
    fn unsupported_multimodal_and_hosted_tools_fail_closed() {
        let multimodal = to_responses_request(&json!({"model":"m","messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"https://example.test/image.png"}}]}]}), true);
        assert!(multimodal.is_err());
        let hosted = to_responses_request(&json!({"model":"m","messages":[],"tools":[{"type":"web_search_preview"}]}), true);
        assert!(hosted.is_err());
    }
}

async fn refresh_if_needed(app: &AppHandle, credential: &mut StoredCredential) -> Result<(), String> {
    if credential.expires_at > now_seconds().saturating_add(60) { return Ok(()); }
    let token: TokenResponse = reqwest::Client::new().post(TOKEN_URL).form(&[
        ("grant_type", "refresh_token"),
        ("client_id", credential.client_id.as_str()),
        ("refresh_token", credential.refresh_token.as_str()),
        ("resource", RESOURCE),
    ]).send().await.map_err(|error| format!("ChatGPT 连接已过期，请重新连接：{error}"))?
        .error_for_status().map_err(|error| format!("ChatGPT 连接已过期，请重新连接：{error}"))?
        .json().await.map_err(|error| format!("无法更新 ChatGPT 连接：{error}"))?;
    let scopes = token.scope.as_deref().map(|value| value.split_whitespace().map(str::to_string).collect::<Vec<_>>()).unwrap_or_else(|| credential.scopes.clone());
    if !scopes.iter().any(|scope| scope == "chatgpt.tokens.use.direct") { return Err("ChatGPT 连接已过期，请重新连接。".into()); }
    credential.access_token = token.access_token;
    if let Some(refresh_token) = token.refresh_token { credential.refresh_token = refresh_token; }
    if let Some(id_token) = token.id_token { credential.id_token = id_token; }
    credential.scopes = scopes;
    credential.expires_at = now_seconds().saturating_add(token.expires_in);
    write_credential(app, credential)
}

async fn validate_id_token(id_token: &str, client_id: &str, nonce: &str) -> Result<(String, Option<String>), String> {
    let discovery = reqwest::Client::new().get(DISCOVERY_URL).send().await
        .map_err(|error| format!("无法验证 OpenAI 账号：{error}"))?.error_for_status()
        .map_err(|error| format!("无法验证 OpenAI 账号：{error}"))?
        .json::<OidcConfiguration>().await.map_err(|error| format!("无法验证 OpenAI 账号：{error}"))?;
    let jwks = reqwest::Client::new().get(&discovery.jwks_uri).send().await
        .map_err(|error| format!("无法验证 OpenAI 账号：{error}"))?.error_for_status()
        .map_err(|error| format!("无法验证 OpenAI 账号：{error}"))?.json::<JwkSet>().await
        .map_err(|error| format!("无法验证 OpenAI 账号：{error}"))?;
    let header = decode_header(id_token).map_err(|_| "OpenAI 返回的身份令牌无效。".to_string())?;
    if !matches!(header.alg, Algorithm::RS256 | Algorithm::ES256 | Algorithm::PS256) {
        return Err("OpenAI 身份令牌使用了不支持的签名算法。".into());
    }
    let kid = header.kid.ok_or_else(|| "OpenAI 身份令牌缺少签名密钥标识。".to_string())?;
    let key = jwks.find(&kid).ok_or_else(|| "OpenAI 身份令牌签名密钥无法识别。".to_string())?;
    let decoding_key = DecodingKey::from_jwk(key).map_err(|_| "OpenAI 身份令牌签名密钥无效。".to_string())?;
    let mut validation = Validation::new(header.alg);
    validation.set_issuer(&[discovery.issuer.as_str()]);
    validation.set_audience(&[client_id]);
    let claims = decode::<IdClaims>(id_token, &decoding_key, &validation)
        .map_err(|_| "OpenAI 身份令牌签名或有效期验证失败。".to_string())?.claims;
    if claims.nonce != nonce || claims.sub.is_empty() { return Err("OpenAI 身份令牌 nonce 校验失败。".into()); }
    Ok((claims.sub, claims.email))
}

fn receive_callback(listener: std::net::TcpListener, expected_state: &str) -> Result<CallbackQuery, String> {
    listener.set_nonblocking(true).map_err(|error| error.to_string())?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                use std::io::{Read, Write};
                stream.set_nonblocking(false).map_err(|error| error.to_string())?;
                stream.set_read_timeout(Some(std::time::Duration::from_secs(2))).map_err(|error| error.to_string())?;
                let mut bytes = [0u8; 8192];
                let mut count = 0;
                while count < bytes.len() {
                    match stream.read(&mut bytes[count..]) {
                        Ok(0) => break,
                        Ok(read) => {
                            count += read;
                            if bytes[..count].windows(4).any(|window| window == b"\r\n\r\n") { break; }
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                        Err(error) => return Err(format!("读取授权回调失败：{error}")),
                    }
                }
                if count == 0 { return Err("授权回调为空。".into()); }
                let request = String::from_utf8_lossy(&bytes[..count]);
                let target = request.lines().next().and_then(|line| line.split_whitespace().nth(1)).ok_or_else(|| "授权回调格式错误。".to_string())?;
                let callback_url = Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| "授权回调地址无效。".to_string())?;
                if callback_url.path() != "/auth/callback" { return Err("授权回调路径无效。".into()); }
                let params = callback_url.query_pairs().into_owned().collect::<std::collections::HashMap<_, _>>();
                if params.get("state").map(String::as_str) != Some(expected_state) { return Err("授权状态校验失败。".into()); }
                let html = "<!doctype html><meta charset=utf-8><title>Project Graph</title><p>授权完成。可以关闭此页面并返回 Project Graph。</p>";
                let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", html.len(), html);
                stream.write_all(response.as_bytes()).map_err(|error| error.to_string())?;
                return Ok(CallbackQuery {
                    code: params.get("code").cloned(), state: params.get("state").cloned(),
                    client_id: params.get("client_id").cloned(), error: params.get("error").cloned(),
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if std::time::Instant::now() >= deadline { return Err("ChatGPT 登录超时。".into()); }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(error) => return Err(format!("接收授权回调失败：{error}")),
        }
    }
}

fn random_url_token(bytes: usize) -> String {
    let mut value = vec![0u8; bytes];
    OsRng.fill_bytes(&mut value);
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, value)
}

fn new_host_id() -> String {
    let mut value = [0u8; 16];
    OsRng.fill_bytes(&mut value);
    value[6] = (value[6] & 0x0f) | 0x40;
    value[8] = (value[8] & 0x3f) | 0x80;
    format!("urn:uuid:{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        value[0],value[1],value[2],value[3],value[4],value[5],value[6],value[7],value[8],value[9],value[10],value[11],value[12],value[13],value[14],value[15])
}

fn now_seconds() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }

fn credential_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|directory| directory.join("chatgpt-auth.dpapi")).map_err(|error| error.to_string())
}

fn read_credential(app: &AppHandle) -> Result<Option<StoredCredential>, String> {
    let path = credential_path(app)?;
    if !path.exists() { return Ok(None); }
    let encrypted = fs::read(path).map_err(|error| format!("无法读取受保护的 ChatGPT 凭据：{error}"))?;
    let plaintext = protect::unprotect(&encrypted)?;
    serde_json::from_slice(&plaintext).map(Some).map_err(|error| format!("受保护的 ChatGPT 凭据格式无效：{error}"))
}

fn write_credential(app: &AppHandle, credential: &StoredCredential) -> Result<(), String> {
    let path = credential_path(app)?;
    let parent = path.parent().ok_or_else(|| "应用数据路径无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let plaintext = serde_json::to_vec(credential).map_err(|error| error.to_string())?;
    let encrypted = protect::protect(&plaintext)?;
    let temp = path.with_extension("dpapi.tmp");
    fs::write(&temp, encrypted).map_err(|error| format!("无法安全保存 ChatGPT 凭据：{error}"))?;
    fs::rename(&temp, &path).map_err(|error| format!("无法完成 ChatGPT 凭据保存：{error}"))
}

fn clear_credential(app: &AppHandle) -> Result<(), String> {
    let path = credential_path(app)?;
    if path.exists() { fs::remove_file(path).map_err(|error| format!("无法清除本机 ChatGPT 凭据：{error}"))?; }
    Ok(())
}

#[cfg(windows)]
mod protect {
    use std::{ffi::c_void, ptr};
    #[repr(C)] struct Blob { size: u32, data: *mut u8 }
    #[link(name = "Crypt32")] unsafe extern "system" {
        fn CryptProtectData(input: *const Blob, description: *const u16, entropy: *const Blob, reserved: *mut c_void, prompt: *const c_void, flags: u32, output: *mut Blob) -> i32;
        fn CryptUnprotectData(input: *const Blob, description: *mut *mut u16, entropy: *const Blob, reserved: *mut c_void, prompt: *const c_void, flags: u32, output: *mut Blob) -> i32;
    }
    #[link(name = "Kernel32")] unsafe extern "system" { fn LocalFree(memory: *mut c_void) -> *mut c_void; }
    fn transform(input: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
        let input_blob = Blob { size: input.len() as u32, data: input.as_ptr() as *mut u8 };
        let mut output = Blob { size: 0, data: ptr::null_mut() };
        let ok = unsafe { if encrypt { CryptProtectData(&input_blob, ptr::null(), ptr::null(), ptr::null_mut(), ptr::null(), 1, &mut output) } else { CryptUnprotectData(&input_blob, ptr::null_mut(), ptr::null(), ptr::null_mut(), ptr::null(), 1, &mut output) } };
        if ok == 0 { return Err("Windows 无法使用当前用户的 DPAPI 保护 ChatGPT 凭据。".into()); }
        let result = unsafe { std::slice::from_raw_parts(output.data, output.size as usize).to_vec() };
        unsafe { LocalFree(output.data as *mut c_void); }
        Ok(result)
    }
    pub fn protect(input: &[u8]) -> Result<Vec<u8>, String> { transform(input, true) }
    pub fn unprotect(input: &[u8]) -> Result<Vec<u8>, String> { transform(input, false) }
}

#[cfg(not(windows))]
mod protect {
    pub fn protect(_: &[u8]) -> Result<Vec<u8>, String> { Err("ChatGPT 账号连接目前仅在 Windows 版本启用。".into()) }
    pub fn unprotect(_: &[u8]) -> Result<Vec<u8>, String> { Err("ChatGPT 账号连接目前仅在 Windows 版本启用。".into()) }
}
