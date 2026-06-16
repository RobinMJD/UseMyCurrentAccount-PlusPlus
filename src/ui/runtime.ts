import type { RuntimeResponse, UseMyCurrentAccountMessage } from "../lib/messages";

export function sendMessage<T>(message: UseMyCurrentAccountMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: RuntimeResponse<T> | undefined) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      if (!response?.success) {
        reject(new Error(response?.error || "UseMyCurrentAccount++ did not return a successful response."));
        return;
      }
      resolve(response.data as T);
    });
  });
}
