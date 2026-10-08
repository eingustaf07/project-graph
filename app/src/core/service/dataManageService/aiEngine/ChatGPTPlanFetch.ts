import { Channel, invoke } from "@tauri-apps/api/core";

const encoder = new TextEncoder();

export function createChatGPTPlanFetch(): typeof fetch {
  return async (_input, init) => {
    const requestBody = JSON.parse(String(init?.body ?? "{}"));
    if (requestBody.stream !== false) {
      const channel = new Channel<string>();
      const requestId = crypto.randomUUID();
      let finished = false;
      let requestStarted = false;
      let abortHandler: (() => void) | undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          channel.onmessage = (chunk) => {
            if (!finished) controller.enqueue(encoder.encode(chunk));
          };
          abortHandler = () => {
            if (finished) return;
            finished = true;
            if (requestStarted) void invoke("chatgpt_cancel_stream", { requestId });
            controller.error(new DOMException("ChatGPT request cancelled", "AbortError"));
            init?.signal?.removeEventListener("abort", abortHandler!);
          };
          if (init?.signal?.aborted) {
            abortHandler();
            return;
          }
          init?.signal?.addEventListener("abort", abortHandler, { once: true });
          requestStarted = true;
          void invoke("chatgpt_stream_chat_completion", { requestBody, requestId, channel })
            .then(() => {
              if (finished) return;
              finished = true;
              init?.signal?.removeEventListener("abort", abortHandler!);
              controller.close();
            })
            .catch((error) => {
              if (finished) return;
              finished = true;
              init?.signal?.removeEventListener("abort", abortHandler!);
              controller.error(error);
            });
        },
        cancel() {
          finished = true;
          if (abortHandler) init?.signal?.removeEventListener("abort", abortHandler);
          if (requestStarted) void invoke("chatgpt_cancel_stream", { requestId });
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }

    const completion = await invoke("chatgpt_generate_chat_completion", { requestBody });
    return new Response(JSON.stringify(completion), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  };
}
