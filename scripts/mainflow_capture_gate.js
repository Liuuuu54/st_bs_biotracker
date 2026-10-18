// 主流快照只收宿主正式生成送出的那一次请求。其它插件也走 fetch 发请求，不挡的话会盖掉主流快照，
// 追踪拿到的就是别人的提示词：回复后有数据库的填表 AI、MVU 额外解析、总结类插件；
// 回复前也有，数据库的剧情推进与纪要召回挂在 GENERATION_AFTER_COMMANDS，在主流送出之前跑。
// 两道条件都要满足：
// - 宿主生成期间：GENERATION_STARTED(type, params, dryRun) 开门，quiet（插件借宿主跑的背景生成）
//   与 dryRun（只拼提示词算 token）不开，生成结束或停止关门。
// - 请求本身是正式生成：宿主送出的聊天补全请求带 type（normal、swipe、regenerate、continue…），
//   借宿主发的背景请求是 quiet，插件自己直接打 API 的请求没有这个栏位。
export function createMainflowCaptureGate() {
  let open = false;
  return {
    onGenerationStarted(...args) {
      const dryRun = args.length > 0 && args[args.length - 1] === true;
      if (dryRun || args[0] === 'quiet') return;
      open = true;
    },
    onGenerationEnded() {
      open = false;
    },
    accepts(body) {
      return open && typeof body?.type === 'string' && body.type !== '' && body.type !== 'quiet';
    },
    close() {
      open = false;
    },
  };
}
