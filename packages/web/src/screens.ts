import { DEFAULT_STRATEGY, effectiveStats, MAX_UPGRADE_LEVEL, specialText, UNITS, upgradeCost, upgradeLevel, UPGRADE_TRACKS, type UpgradeTrack } from '@catfight/engine';
import { api, setToken, type Category, type Me, type StageInfo } from './api';
import { runBattle } from './game/battle';
import { escapeHtml } from './game/quiz';

type Nav = (screen: string) => void;

export interface Ctx {
  root: HTMLElement;
  me: Me | null;
  nav: Nav;
  /** one-shot message for the login screen (e.g. session expired) */
  notice: string | null;
  /** runs right after a successful login/register/boot (e.g. re-sends a battle result recorded while logged out) */
  onLogin: () => Promise<void>;
}


function screen(root: HTMLElement, html: string): HTMLElement {
  root.innerHTML = '';
  const s = document.createElement('div');
  s.className = 'screen';
  s.innerHTML = html;
  root.appendChild(s);
  return s;
}

export function authScreen(ctx: Ctx) {
  let mode: 'login' | 'register' = 'login';
  const render = () => {
    const s = screen(
      ctx.root,
      `<div class="hero"><img src="/assets/tank.png" alt=""><img src="/assets/archer.png" alt=""><img src="/assets/mage.png" alt=""></div>
      <h1>金融貓咪大作戰</h1>
      <p class="sub">答題賺分數，召喚貓咪推倒對方的塔</p>
      <div class="card stack">
        <input id="u" placeholder="帳號（3–20 字英數或底線）" autocomplete="username" maxlength="20">
        ${mode === 'register' ? '<input id="d" placeholder="顯示名稱（排行榜上顯示）" maxlength="20">' : ''}
        <input id="p" type="password" placeholder="密碼（至少 8 字）" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}">
        <div class="error" id="err">${ctx.notice ? escapeHtml(ctx.notice) : ''}</div>
        <button class="primary" id="go">${mode === 'login' ? '登入' : '建立帳號'}</button>
        <button class="ghost" id="switch">${mode === 'login' ? '還沒有帳號？建立一個' : '已有帳號？登入'}</button>
      </div>
      <p class="sub">只保存帳號、顯示名稱與加密後的密碼，不收集其他個人資料。</p>`,
    );
    s.querySelector('#switch')!.addEventListener('click', () => {
      mode = mode === 'login' ? 'register' : 'login';
      render();
    });
    const go = async () => {
      const u = (s.querySelector('#u') as HTMLInputElement).value.trim();
      const p = (s.querySelector('#p') as HTMLInputElement).value;
      const d = (s.querySelector('#d') as HTMLInputElement | null)?.value.trim() ?? '';
      const err = s.querySelector('#err') as HTMLElement;
      err.textContent = '';
      try {
        const r = mode === 'login' ? await api.login(u, p) : await api.register(u, d || u, p);
        setToken(r.token);
        ctx.me = r.me;
        ctx.notice = null;
        await ctx.onLogin();
        ctx.nav('menu');
      } catch (e) {
        err.textContent = (e as Error).message;
      }
    };
    s.querySelector('#go')!.addEventListener('click', go);
    s.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => e.key === 'Enter' && go()));
  };
  render();
}

export function menuScreen(ctx: Ctx) {
  const me = ctx.me!;
  const s = screen(
    ctx.root,
    `<h1>金融貓咪大作戰</h1>
    <div class="card row"><div class="grow"><b>${escapeHtml(me.displayName)}</b><div class="sub" style="text-align:left">積分 ${me.rating.rating} ・ 點數 ${me.points} ・ 已通關 ${me.clearedCount} 關</div></div>
      <button class="ghost" id="logout">登出</button></div>
    <button class="list-btn card" id="stage"><img src="/assets/tank.png" alt=""><div><div class="title">關卡模式</div><div class="meta">逐關推進，賺點數解鎖新貓咪</div></div></button>
    <button class="list-btn card" id="versus"><img src="/assets/runner.png" alt=""><div><div class="title">對戰模式</div><div class="meta">選題型配對其他玩家，爭排行榜積分</div></div></button>
    <button class="list-btn card" id="shop"><img src="/assets/scholar.png" alt=""><div><div class="title">貓咪圖鑑 / 解鎖</div><div class="meta">用點數解鎖新單位</div></div></button>
    <button class="list-btn card" id="lb"><img src="/assets/medic.png" alt=""><div><div class="title">排行榜</div><div class="meta">對戰積分前 100 名</div></div></button>`,
  );
  s.querySelector('#stage')!.addEventListener('click', () => ctx.nav('stages'));
  s.querySelector('#versus')!.addEventListener('click', () => ctx.nav('versus'));
  s.querySelector('#shop')!.addEventListener('click', () => ctx.nav('shop'));
  s.querySelector('#lb')!.addEventListener('click', () => ctx.nav('leaderboard'));
  s.querySelector('#logout')!.addEventListener('click', () => {
    setToken(null);
    ctx.me = null;
    ctx.nav('auth');
  });
}

export async function stagesScreen(ctx: Ctx) {
  const s = screen(ctx.root, `<div class="row"><button class="ghost" id="back">← 返回</button><h2 class="grow">關卡模式</h2></div><div class="stack" id="list">載入中…</div>`);
  s.querySelector('#back')!.addEventListener('click', () => ctx.nav('menu'));
  const stages = await api.stages();
  const list = s.querySelector('#list')!;
  list.innerHTML = '';
  if (!stages.length) {
    list.innerHTML = '<p class="sub">題庫還是空的，請先匯入題目。</p>';
    return;
  }
  for (const st of stages) {
    const b = document.createElement('button');
    b.className = 'list-btn card';
    b.disabled = !st.unlocked;
    b.innerHTML = `<div class="pill">${st.id}</div><img src="/assets/boss/${st.boss.unitId}.png" alt="" onerror="this.style.visibility='hidden'"><div class="grow"><div class="title">${escapeHtml(st.name)} ・ ${escapeHtml(st.boss.name)} ${st.cleared ? '✅' : ''}</div><div class="meta">${escapeHtml(st.boss.desc)}<br>基準正確率 ${Math.round(st.targetAccuracy * 100)}% ・ 敵方小喵強化 Lv ${st.powerTier + 1} ・ 首次通關 +${st.reward} 點 ・ 之後每次通關 +${Math.round(st.reward / 4)} 點 ・ 落敗也有一半</div></div>`;
    b.addEventListener('click', () => startStage(ctx, st));
    list.appendChild(b);
  }
}

async function startStage(ctx: Ctx, st: StageInfo) {
  for (;;) {
    const r = await runBattle(ctx.root, { mode: 'stage', category: st.category, stage: st.id, opponentName: `第 ${st.id} 關 ${st.boss.name}`, ai: st.ai, me: ctx.me!, boss: st.boss });
    if (r.outcome) ctx.me = r.outcome.me;
    if (!r.retry || !ctx.me) break;
  }
  ctx.nav('stages');
}

export async function versusScreen(ctx: Ctx) {
  const s = screen(
    ctx.root,
    `<div class="row"><button class="ghost" id="back">← 返回</button><h2 class="grow">對戰模式</h2></div>
    <p class="sub">選一個題型，系統會配對一位在該題型有紀錄的玩家。對手的答題效率會轉成 AI 的出兵速度。</p>
    <div class="stack" id="list"></div><div class="error" id="err"></div>`,
  );
  s.querySelector('#back')!.addEventListener('click', () => ctx.nav('menu'));
  const list = s.querySelector('#list')!;
  const cats: Category[] = (await api.categories()).filter((c) => c.count > 0);
  if (!cats.length) list.innerHTML = '<p class="sub">題庫還是空的，請先匯入題目。</p>';
  for (const c of cats) {
    const st = ctx.me!.stats.find((x) => x.category === c.id);
    const b = document.createElement('button');
    b.className = 'list-btn card';
    b.innerHTML = `<div class="grow"><div class="title">${escapeHtml(c.name)}</div><div class="meta">${c.count} 題 ・ ${st ? `你的紀錄：${st.games} 場，每秒 ${st.scorePerSec.toFixed(2)} 分` : '尚無紀錄'}</div></div>`;
    b.addEventListener('click', async () => {
      const err = s.querySelector('#err') as HTMLElement;
      try {
        b.disabled = true;
        const op = await api.opponent(c.id);
        for (;;) {
          const r = await runBattle(ctx.root, {
            mode: 'versus',
            category: c.id,
            opponentId: op.opponentId,
            opponentName: `${op.displayName}（${op.rating}）`,
            ai: { scorePerSec: op.scorePerSec, strategy: DEFAULT_STRATEGY, warmupMs: 3000 },
            me: ctx.me!,
          });
          if (r.outcome) ctx.me = r.outcome.me;
          if (!r.retry || !ctx.me) break;
        }
        ctx.nav('versus');
      } catch (e) {
        b.disabled = false;
        err.textContent = (e as Error).message;
      }
    });
    list.appendChild(b);
  }
}

export function shopScreen(ctx: Ctx) {
  const render = () => {
    const me = ctx.me!;
    const s = screen(
      ctx.root,
      `<div class="row"><button class="ghost" id="back">← 返回</button><h2 class="grow">貓咪圖鑑 / 強化</h2><span class="pill">點數 ${me.points}</span></div>
      <p class="sub">用關卡點數解鎖與強化。生命／攻擊每級 +10%，特技每隻貓不同，最高 10 級。</p>
      <div class="stack" id="list"></div><div class="error" id="err"></div>`,
    );
    s.querySelector('#back')!.addEventListener('click', () => ctx.nav('menu'));
    const list = s.querySelector('#list')!;
    const err = s.querySelector('#err') as HTMLElement;
    const TRACK_NAME: Record<UpgradeTrack, string> = { hp: '生命', atk: '攻擊', special: '特技' };
    for (const u of Object.values(UNITS)) {
      const owned = me.unlockedUnits.includes(u.id);
      const st = effectiveStats(u, me.upgrades);
      const card = document.createElement('div');
      card.className = 'card stack unit-card' + (owned ? ' owned' : '');
      card.innerHTML = `<div class="row"><img src="/assets/${u.id}.png" alt="" class="unit-icon"><div class="grow"><div class="title">${u.name}</div>
          <div class="meta">${u.desc}<br>召喚 ${u.cost} 分 ・ 血 ${st.hp} ・ 攻 ${Math.round(st.dps)}/秒${u.range > 30 ? ` ・ 射程 ${st.range}` : ''}</div></div>
          ${owned ? '<span class="pill">已解鎖</span>' : `<button class="primary unlock" ${me.points < u.unlockCost ? 'disabled' : ''}>解鎖 ${u.unlockCost} 點</button>`}</div>`;
      if (!owned) {
        card.querySelector('.unlock')!.addEventListener('click', async () => {
          try {
            ctx.me = await api.unlock(u.id);
            render();
          } catch (e) {
            err.textContent = (e as Error).message;
          }
        });
      } else {
        for (const track of UPGRADE_TRACKS) {
          const lv = upgradeLevel(me.upgrades, u.id, track);
          const maxed = lv >= MAX_UPGRADE_LEVEL;
          const cost = upgradeCost(lv + 1);
          const effect =
            track === 'hp' ? `最大血量 +${lv * 10}%` : track === 'atk' ? `傷害 +${lv * 10}%` : specialText(u, lv);
          const nextEffect = maxed ? '' : track === 'hp' ? `→ +${(lv + 1) * 10}%` : track === 'atk' ? `→ +${(lv + 1) * 10}%` : `→ ${specialText(u, lv + 1)}`;
          const row = document.createElement('div');
          row.className = 'row upgrade-row';
          row.innerHTML = `<div class="grow"><b>${TRACK_NAME[track]}</b> <span class="pill">Lv ${lv}/${MAX_UPGRADE_LEVEL}</span><div class="meta">${effect} <span class="next">${nextEffect}</span></div></div>
            <button class="up" ${maxed || me.points < cost ? 'disabled' : ''}>${maxed ? 'MAX' : `${cost} 點`}</button>`;
          if (!maxed)
            row.querySelector('.up')!.addEventListener('click', async () => {
              try {
                ctx.me = await api.upgrade(u.id, track);
                render();
              } catch (e) {
                err.textContent = (e as Error).message;
              }
            });
          card.appendChild(row);
        }
      }
      list.appendChild(card);
    }
  };
  render();
}

export async function leaderboardScreen(ctx: Ctx) {
  const s = screen(ctx.root, `<div class="row"><button class="ghost" id="back">← 返回</button><h2 class="grow">排行榜</h2></div><div class="card" id="tbl">載入中…</div>`);
  s.querySelector('#back')!.addEventListener('click', () => ctx.nav('menu'));
  const rows = await api.leaderboard();
  s.querySelector('#tbl')!.innerHTML = rows.length
    ? `<table class="lb"><tr><th>#</th><th>玩家</th><th>積分</th><th>勝/負</th></tr>${rows
        .map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.displayName)}</td><td class="num">${r.rating}</td><td class="num">${r.wins}/${r.losses}</td></tr>`)
        .join('')}</table>`
    : '<p class="sub">還沒有人打過對戰，你來當第一個！</p>';
}
