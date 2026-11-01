import { cloudServiceBaseUrl } from "./CloudServiceConfig";

// 账户可使用官方默认地址；其余功能仍保留原有的显式配置开关。
const hasApiBaseUrl = (import.meta.env.LR_API_BASE_URL ?? "").trim() !== "";

export namespace FeatureFlags {
  /**
   * 用户登录、注册以及所有和云服务有关的功能
   */
  export const USER = cloudServiceBaseUrl !== null;
  /**
   * AI扩展节点等所有和AI有关的功能
   */
  export const AI = hasApiBaseUrl;
  export const TELEMETRY = hasApiBaseUrl;
}
