import Phaser from 'phaser';
import {
  addScore,
  aiStep,
  canSpawn,
  createAi,
  createBattle,
  DEFAULT_STRATEGY,
  spawn,
  step,
  TICK_MS,
  UNITS,
  type AiConfig,
  type BattleState,
} from '@catfight/engine';
import { api, type Me, type MatchResultInput } from '../api';
import { BattleScene } from './BattleScene';
import { escapeHtml, QuestionFeed, QuizPanel } from './quiz';

export interface BattleSetup {
  mode: 'stage' | 'versus';
  category: string;
  stage?: number;
  opponentId?: number | null;
  opponentName: string;
  ai: AiConfig;
  me: Me;
}

export interface BattleOutcome {
  won: boolean;
  seconds: number;
  score: number;
  questions: number;
  correct: number;
  reward: number;
  ratingDelta: number;
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
    hud.innerHTML = `<div><div class="score" id="score">0</div><div>${escapeHtml(setup.me.displayName)}</div></div>
      <div class="timer" id="timer">0:00</div>
      <div style="text-align:right"><div>${escapeHtml(setup.opponentName)}</div><div class="timer" id="enemy-score"></div></div>`;
    top.appendChild(hud);
    const bar = document.createElement('div');
    bar.className = 'unit-bar';
    wrap.append(top, bar);
    root.appendChild(wrap);

    const state: BattleState = createBattle({ left: setup.me.upgrades ?? {} });
    // debug/e2e hook
    (window as unknown as { __cf?: unknown }).__cf = { get entities() { return state.entities.length; }, get state() { return state; } };
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

    const driver = {
      state,
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

    feed
      .init()
      .then(() => quiz.start())
      .catch((e) => {
        toast(wrap, `題目載入失敗：${(e as Error).message}`);
      });
    refreshBar();

    async function finish() {
      if (finished) return;
      finished = true;
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
      };
      let outcome: BattleOutcome | null = null;
      let err = '';
      try {
        const r = await api.result(payload);
        outcome = { won, seconds, score: totalScore, questions: payload.questions, correct: payload.correct, reward: r.reward, ratingDelta: r.ratingDelta, me: r.me };
      } catch (e) {
        err = (e as Error).message;
      }
      showResult(wrap, won, payload, outcome, err, quiz.stats.wrong, (retry) => {
        game.destroy(true);
        root.innerHTML = '';
        resolve({ outcome, retry });
      });
    }
  });
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
  wrong: { question: { text: string; options: string[]; answerIndex: number; explanation?: string }; chosen: number }[],
  done: (retry: boolean) => void,
) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  const acc = p.questions ? Math.round((p.correct / p.questions) * 100) : 0;
  const rewardLine = outcome
    ? p.mode === 'stage'
      ? `獲得 ${outcome.reward} 點`
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
    ${wrong.length ? `<h2>答錯的題目（${wrong.length}）</h2>` : '<p class="sub">全部答對，太強了！</p>'}
    <div class="review">${wrong
      .map(
        (w) => `<div class="item"><div>${escapeHtml(w.question.text)}</div>
          <div class="ans">正解：${escapeHtml(w.question.options[w.question.answerIndex])}</div>
          <div class="exp">你的答案：${escapeHtml(w.question.options[w.chosen])}${w.question.explanation ? `<br>${escapeHtml(w.question.explanation)}` : ''}</div></div>`,
      )
      .join('')}</div>`;
  ov.querySelector('#retry')!.addEventListener('click', () => done(true));
  ov.querySelector('#back')!.addEventListener('click', () => done(false));
  parent.appendChild(ov);
}
