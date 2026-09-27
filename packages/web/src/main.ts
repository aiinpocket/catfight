import { api, getToken, setToken } from './api';
import { authScreen, leaderboardScreen, menuScreen, shopScreen, stagesScreen, versusScreen, type Ctx } from './screens';

const root = document.getElementById('app')!;
const ctx: Ctx = { root, me: null, nav };

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
      return versusScreen(ctx);
    case 'shop':
      return shopScreen(ctx);
    case 'leaderboard':
      return void leaderboardScreen(ctx).catch(fail);
    default:
      return menuScreen(ctx);
  }
}

function fail(e: Error) {
  if ((e as { status?: number }).status === 401) {
    setToken(null);
    ctx.me = null;
    nav('auth');
  } else {
    alert(e.message);
    nav('menu');
  }
}

async function boot() {
  if (getToken()) {
    try {
      ctx.me = await api.me();
      nav('menu');
      return;
    } catch {
      setToken(null);
    }
  }
  nav('auth');
}

boot();
