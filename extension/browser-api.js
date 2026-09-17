const api = globalThis.browser ?? globalThis.chrome;

function requireApi() {
  if (!api) throw new Error('WebExtension APIs are unavailable.');
  return api;
}

// Firefox's WebExtension APIs return promises; Chrome's take a callback and report a failure through runtime.lastError.
export function invokeExtensionMethod(method, receiver, ...args) {
  if (globalThis.browser) return method.call(receiver, ...args);
  return new Promise((resolve, reject) => {
    method.call(receiver, ...args, (value) => {
      const error = globalThis.chrome?.runtime?.lastError;
      if (error) reject(new Error(error.message));
      else resolve(value);
    });
  });
}

export function newRequestId() {
  return crypto.randomUUID();
}

export function sendCommand(command) {
  const extensionApi = requireApi();
  return invokeExtensionMethod(extensionApi.runtime.sendMessage, extensionApi.runtime, command);
}

export function getSnapshot() {
  return sendCommand({ type: 'snapshot.get', requestId: newRequestId() });
}

export function subscribeToSnapshots(listener) {
  const extensionApi = requireApi();
  const handler = (changes, areaName) => {
    const next = changes['auctionCompanion:v1']?.newValue;
    if (areaName === 'local' && next) listener(next, next.revision);
  };
  extensionApi.storage.onChanged.addListener(handler);
  return () => extensionApi.storage.onChanged.removeListener(handler);
}

export async function requestNotificationPermission() {
  const extensionApi = requireApi();
  return invokeExtensionMethod(
    extensionApi.permissions.request,
    extensionApi.permissions,
    { permissions: ['notifications'] },
  );
}

export function storageLocalAdapter() {
  const extensionApi = requireApi();
  return {
    get: (key) => invokeExtensionMethod(extensionApi.storage.local.get, extensionApi.storage.local, key),
    set: (items) => invokeExtensionMethod(extensionApi.storage.local.set, extensionApi.storage.local, items),
  };
}

export function extensionApi() {
  return requireApi();
}
