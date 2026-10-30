const PREFIX = "ProjectGraphClipboard/1\n";

export interface ClipboardPayload {
  stageObjects: unknown[];
  attachments: Record<string, { data: string; type: string }>;
}

export function encodeClipboardPayload(
  stageObjects: unknown[],
  attachments: Map<string, { data: ArrayBuffer; type: string }>,
): string {
  const encoded: ClipboardPayload["attachments"] = {};
  for (const [id, attachment] of attachments) {
    const bytes = new Uint8Array(attachment.data);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    encoded[id] = { data: btoa(binary), type: attachment.type };
  }
  return PREFIX + JSON.stringify({ stageObjects, attachments: encoded } satisfies ClipboardPayload);
}

export function decodeClipboardPayload(text: string): ClipboardPayload | undefined {
  if (!text.startsWith(PREFIX)) return;
  const payload = JSON.parse(text.slice(PREFIX.length));
  if (
    !payload ||
    !Array.isArray(payload.stageObjects) ||
    !payload.attachments ||
    typeof payload.attachments !== "object"
  )
    throw new Error("节点剪贴板格式无效，请重新复制");
  for (const attachment of Object.values(payload.attachments)) {
    if (
      !attachment ||
      typeof attachment !== "object" ||
      !("data" in attachment) ||
      typeof attachment.data !== "string" ||
      !("type" in attachment) ||
      typeof attachment.type !== "string"
    )
      throw new Error("节点剪贴板附件无效，请重新复制");
  }
  return payload;
}

export function remapClipboardAttachments(value: unknown, ids: Map<string, string>): void {
  if (!value || typeof value !== "object") return;
  if ("attachmentId" in value && typeof value.attachmentId === "string" && ids.has(value.attachmentId))
    value.attachmentId = ids.get(value.attachmentId)!;
  for (const child of Object.values(value)) remapClipboardAttachments(child, ids);
}
