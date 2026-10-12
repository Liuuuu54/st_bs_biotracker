// 本插件自己发出的请求：fetch 拦截（主流快照、MVU 额外解析观测）要跳过它们。
// 旧做法是请求期间开一个全域旗标，期间主流与其他扩充的请求也一起被跳过——
// 使用者在追踪还没跑完时送出下一句，那轮主流请求就漏抓、快照停在更旧的一轮。
// 改成记下自己的请求选项物件：拦截器拿到的就是同一个物件（中间层照原样转交），只认它。
const OWN_REQUESTS_KEY = '__bs_biotracker_own_requests__';

function getRegistry() {
  if (!(globalThis[OWN_REQUESTS_KEY] instanceof WeakSet)) globalThis[OWN_REQUESTS_KEY] = new WeakSet();
  return globalThis[OWN_REQUESTS_KEY];
}

export function markOwnRequest(init) {
  if (init && typeof init === 'object') getRegistry().add(init);
  return init;
}

export function isOwnRequest(init) {
  return Boolean(init && typeof init === 'object' && getRegistry().has(init));
}
