import { api, getToken, setToken, setUnauthorizedHandler, takePendingResult } from './api';
import { authScreen, leaderboardScreen, menuScreen, shopScreen, stagesScreen, versusScreen, type Ctx } from './screens';

const root = document.getElementById('app')!;
const ctx: Ctx = { root, me: null, nav, notice: null, onLogin };

// any 401 anywhere (menu buttons, shop, battle result) sends the player back to the login screen
setUnauthorizedHandler(() => {
  if (!ctx.me) return; // already on the login screen
  ctx.me = null;
  ctx.notice = '登入已過期，請重新登入';
  // mid-battle: leave the result screen up (the result is stashed); nav() redirects to login once the player leaves it
  if (root.querySelector('.battle')) return;
  nav('auth');
});

/** After a successful login: record a battle that finished while the session was expired, if any. */
async function onLogin() {
  const pending = takePendingResult();
  if (!pending) return;
  try {
    const r = await api.result(pending);
    ctx.me = r.me;
    const bits = [`上一場${pending.won ? '勝利' : '落敗'}的戰績已補登`];
    if (r.reward) bits.push(`+${r.reward} 點`);
    if (r.ratingDelta) bits.push(`積分 ${r.ratingDelta > 0 ? '+' : ''}${r.ratingDelta}`);
    alert(bits.join('，'));
  } catch (e) {
    alert(`上一場戰績補登失敗：${(e as Error).message}`);
  }
}

function nav(screen: string) {
  if (!ctx.me && screen !== 'auth') screen = 'auth';
  switch (screen) {
    case 'auth':
      return authScreen(ctx);
    case 'menu':
      return menuScreen(ctx);
    case 'stages':
      return void stagesScreen(ctx).catch(fail);
    case 'versus':
      return void versusScreen(ctx).catch(fail);
    case 'shop':
      return shopScreen(ctx);
    case 'leaderboard':
      return void leaderboardScreen(ctx).catch(fail);
    default:
      return menuScreen(ctx);
  }
}

function fail(e: Error) {
  // 401 is already routed to the login screen by the unauthorized handler
  if ((e as { status?: number }).status === 401) return;
  alert(e.message);
  nav('menu');
}

async function boot() {
  if (getToken()) {
    try {
      ctx.me = await api.me();
      await onLogin();
      nav('menu');
      return;
    } catch {
      setToken(null);
      ctx.notice = '登入已過期，請重新登入';
    }
  }
  nav('auth');
}

boot();
