import { createContext, useContext } from "react";

export const PortalContainerContext = createContext<HTMLElement | undefined>(undefined);
export function usePortalContainer() {
  return useContext(PortalContainerContext);
}
