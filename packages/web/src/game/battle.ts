import Phaser from 'phaser';
import {
  addScore,
  aiStep,
  canSpawn,
  createAi,
  createBattle,
  DEFAULT_STRATEGY,
  spawn,
  STAGE_START_SCORE,
  step,
  TICK_MS,
  UNITS,
  type AiConfig,
  type BattleState,
  spawnFree,
} from '@catfight/engine';
import { api, stashPendingResult, type Me, type MatchResultInput, ApiError } from '../api';
import { BattleScene } from './BattleScene';
import { escapeHtml, QuestionFeed, QuizPanel, type AnswerRecord } from './quiz';

export interface BattleSetup {
  mode: 'stage' | 'versus';
  category: string;
  stage?: number;
  opponentId?: number | null;
  opponentName: string;
  ai: AiConfig;
  me: Me;
  boss?: { unitId: string; name: string; desc: string };
}

export interface BattleOutcome {
  won: boolean;
  seconds: number;
  score: number;
  questions: number;
  correct: number;
  reward: number;
  ratingDelta: number;
  /** total times the player has ever missed each question answered this battle (by question id) */
  wrongCounts: Record<number, number>;
  me: Me;
}

/** Mounts a full battle (canvas + unit bar + quiz) into root; resolves when the player leaves the result screen. */
export function runBattle(root: HTMLElement, setup: BattleSetup): Promise<{ outcome: BattleOutcome | null; retry: boolean }> {
  return new Promise((resolve) => {
    root.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'battle';
    const top = document.createElement('div');
    top.className = 'battle-top';
    const hud = document.createElement('div');
    hud.className = 'hud';
    hud.innerHTML = `<div><div class="score" id="score">${setup.mode === 'stage' ? STAGE_START_SCORE : 0}</div><div>${escapeHtml(setup.me.displayName)}</div></div>
      <div class="timer" id="timer">0:00</div>
      <div style="text-align:right"><div>${escapeHtml(setup.opponentName)}</div><div class="timer" id="enemy-score"></div></div>`;
    top.appendChild(hud);
    const bar = document.createElement('div');
    bar.className = 'unit-bar';
    wrap.append(top, bar);
    root.appendChild(wrap);

    const state: BattleState = createBattle({ left: setup.me.upgrades ?? {} }, setup.mode === 'stage' ? { left: STAGE_START_SCORE, right: setup.ai.startScore ?? 0 } : {});
    // debug/e2e hook
    (window as unknown as { __cf?: unknown }).__cf = {
      get entities() { return state.entities.length; },
      get state() { return state; },
      // visual checks: drop any unit onto the field without spending score (client-side only; the server never sees it)
      spawnFree: (side: 'left' | 'right', unitId: string, x?: number) => spawnFree(state, side, unitId, x),
    };
    const ai = createAi('right', { ...setup.ai, strategy: setup.ai.strategy.length ? setup.ai.strategy : DEFAULT_STRATEGY });
    let totalScore = 0;
    let finished = false;

    // unit buttons
    const unitBtns: { id: string; el: HTMLButtonElement }[] = [];
    for (const id of setup.me.unlockedUnits) {
      const u = UNITS[id];
      if (!u) continue;
      const b = document.createElement('button');
      b.className = 'unit-btn';
      b.innerHTML = `<img src="/assets/${id}.png" alt=""><span>${u.name}</span><span class="cost">${u.cost}</span>`;
      b.title = u.desc;
      b.addEventListener('click', () => {
        if (spawn(state, 'left', id)) refreshBar();
      });
      bar.appendChild(b);
      unitBtns.push({ id, el: b });
    }
    const scoreEl = hud.querySelector('#score') as HTMLElement;
    const timerEl = hud.querySelector('#timer') as HTMLElement;
    function refreshBar() {
      scoreEl.textContent = String(state.score.left);
      for (const { id, el } of unitBtns) {
        const ok = canSpawn(state, 'left', id);
        el.disabled = !ok;
        el.classList.toggle('ready', ok);
      }
    }

    // quiz
    const feed = new QuestionFeed(setup.category);
    const quiz = new QuizPanel(feed, {
      onCorrect: () => {
        const gained = addScore(state, 'left');
        totalScore += gained;
        refreshBar();
      },
      onBatchDone: (correct, total) => toast(wrap, `本批 ${total} 題正確率 ${Math.round((correct / total) * 100)}%`),
    });
    wrap.appendChild(quiz.el);

    const bossNames = new Map<string, string>();
    if (setup.boss) bossNames.set(setup.boss.unitId, setup.boss.name);
    const driver = {
      state,
      bossId: setup.boss?.unitId,
      bossName: setup.boss?.name,
      onEvents(events: BattleState['events']) {
        for (const ev of events) {
          if (ev.type === 'spawn' && ev.unitId.startsWith('boss_')) toast(wrap, `BOSS 登場：${bossNames.get(ev.unitId) ?? ev.unitId}`);
          if (ev.type === 'death' && ev.unitId.startsWith('boss_')) toast(wrap, `擊敗 ${bossNames.get(ev.unitId) ?? 'BOSS'}！`);
          if (ev.type === 'special' && ev.kind === 'lastStand') toast(wrap, `${bossNames.get(ev.unitId) ?? 'BOSS'} 復活了！`);
        }
      },
      tick() {
        if (finished) return;
        aiStep(state, ai, TICK_MS);
        step(state, TICK_MS);
        if (state.tick % 4 === 0) {
          refreshBar();
          const s = Math.floor(state.timeMs / 1000);
          timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        }
        if (state.winner) finish();
      },
    };

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: top,
      backgroundColor: '#0f1a33',
      scale: { mode: Phaser.Scale.RESIZE, width: top.clientWidth || 360, height: top.clientHeight || 240 },
      scene: [BattleScene],
      render: { pixelArt: false, antialias: true },
    });
    game.scene.start('battle', { driver });
    (window as unknown as { __cf: { game?: Phaser.Game } }).__cf.game = game;

    feed
      .init()
      .then(() => quiz.start())
      .catch((e) => {
        toast(wrap, `題目載入失敗：${(e as Error).message}`);
      });
    refreshBar();

    // tell the server a battle is in progress so deploys can wait for a quiet moment
    const heartbeat = window.setInterval(() => void api.heartbeat().catch(() => {}), 30_000);
    void api.heartbeat().catch(() => {});

    async function finish() {
      if (finished) return;
      finished = true;
      window.clearInterval(heartbeat);
      quiz.stop();
      const won = state.winner === 'left';
      const seconds = Math.max(1, Math.round(state.timeMs / 1000));
      const payload: MatchResultInput = {
        mode: setup.mode,
        category: setup.category,
        stage: setup.stage,
        opponentId: setup.opponentId ?? null,
        won,
        score: totalScore,
        seconds,
        questions: quiz.stats.answered,
        correct: quiz.stats.correct,
        answers: quiz.stats.log.map((a) => ({ questionId: a.question.id, correct: a.correct })),
      };
      let outcome: BattleOutcome | null = null;
      let err = '';
      // the server may be mid-restart (deploy): retry a few times before giving up on recording the result
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const r = await api.result(payload);
          outcome = { won, seconds, score: totalScore, questions: payload.questions, correct: payload.correct, reward: r.reward, ratingDelta: r.ratingDelta, wrongCounts: r.wrongCounts ?? {}, me: r.me };
          err = '';
          break;
        } catch (e) {
          err = (e as Error).message;
          if (e instanceof ApiError && e.status === 401) {
            // session expired while playing: keep the result and send it after the next login
            stashPendingResult(payload);
            err = '登入已過期，這場戰績會在下次登入後補登';
            break;
          }
          if (e instanceof ApiError && e.status >= 400 && e.status < 500) break;
          await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
        }
      }
      showResult(wrap, won, payload, outcome, err, quiz.stats.log, (retry) => {
        game.destroy(true);
        root.innerHTML = '';
        resolve({ outcome, retry });
      });
    }
  });
}

/**
 * Full answer record for the battle, in order: right answers are listed too (some were guesses),
 * each with how many times the player has missed that question in total.
 */
function reviewHtml(log: AnswerRecord[], wrongCounts: Record<number, number> | null): string {
  if (!log.length) return '<p class="sub">這場沒有作答紀錄。</p>';
  const bad = log.filter((a) => !a.correct).length;
  const items = log
    .map((a, i) => {
      const q = a.question;
      const misses = wrongCounts?.[q.id] ?? 0;
      const history = wrongCounts ? (misses > 0 ? `<span class="miss">這題你累計答錯 ${misses} 次</span>` : '<span class="clean">這題你沒答錯過</span>') : '';
      return `<div class="item ${a.correct ? 'ok' : 'bad'}">
          <div class="q-no"><b>${a.correct ? '✓' : '✗'} 第 ${i + 1} 題</b>${history}</div>
          <div class="q-body">${escapeHtml(q.text)}</div>
          <div class="ans">正解：${escapeHtml(q.options[q.answerIndex] ?? '')}</div>
          ${a.correct ? '' : `<div class="yours">你的答案：${escapeHtml(q.options[a.chosen] ?? '')}</div>`}
          ${q.explanation ? `<div class="exp">${escapeHtml(q.explanation)}</div>` : ''}</div>`;
    })
    .join('');
  return `<h2>答題紀錄（${log.length} 題，答錯 ${bad}）</h2>
    <div class="review-filter row"><button class="grow on" data-f="all">全部</button><button class="grow" data-f="bad" ${bad ? '' : 'disabled'}>只看答錯</button></div>
    <div class="review">${items}</div>`;
}

function toast(parent: HTMLElement, text: string) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  parent.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

function showResult(
  parent: HTMLElement,
  won: boolean,
  p: MatchResultInput,
  outcome: BattleOutcome | null,
  err: string,
  log: AnswerRecord[],
  done: (retry: boolean) => void,
) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  const acc = p.questions ? Math.round((p.correct / p.questions) * 100) : 0;
  const rewardLine = outcome
    ? p.mode === 'stage'
      ? `${won ? '獲得' : '雖然落敗，仍獲得'} ${outcome.reward} 點`
      : `積分 ${outcome.ratingDelta >= 0 ? '+' : ''}${outcome.ratingDelta}`
    : `<span class="error">結果上傳失敗：${escapeHtml(err)}</span>`;
  ov.innerHTML = `
    <h1 class="${won ? 'win' : 'lose'}">${won ? '勝利！' : '落敗…'}</h1>
    <p class="sub">${rewardLine}</p>
    <div class="stats card">
      <div><div class="v">${p.questions}</div><div class="k">答題數</div></div>
      <div><div class="v">${acc}%</div><div class="k">正確率</div></div>
      <div><div class="v">${Math.floor(p.seconds / 60)}:${String(p.seconds % 60).padStart(2, '0')}</div><div class="k">時間</div></div>
    </div>
    <div class="row"><button class="primary grow" id="retry">再玩一次</button><button class="grow" id="back">回主選單</button></div>
    ${reviewHtml(log, outcome?.wrongCounts ?? null)}`;
  const review = ov.querySelector('.review') as HTMLElement | null;
  ov.querySelectorAll<HTMLButtonElement>('.review-filter button').forEach((b) =>
    b.addEventListener('click', () => {
      ov.querySelectorAll('.review-filter button').forEach((x) => x.classList.toggle('on', x === b));
      review?.classList.toggle('only-bad', b.dataset.f === 'bad');
    }),
  );
  ov.querySelector('#retry')!.addEventListener('click', () => done(true));
  ov.querySelector('#back')!.addEventListener('click', () => done(false));
  parent.appendChild(ov);
}
