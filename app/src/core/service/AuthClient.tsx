import { fetch } from "@tauri-apps/plugin-http";
import { createAuthClient } from "better-auth/client";
import { cloudServiceBaseUrl } from "./CloudServiceConfig";

export const authClient = cloudServiceBaseUrl
  ? createAuthClient({
      baseURL: `${cloudServiceBaseUrl}/api/auth`,
      plugins: [],
      fetchOptions: {
        customFetchImpl: fetch,
      },
    })
  : null;
