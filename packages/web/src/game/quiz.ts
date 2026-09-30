import { api, type Question } from '../api';

export const CORRECT_DELAY_MS = 300;
export const WRONG_DELAY_MS = 1200;
export const BATCH_SIZE = 50;
export const PREFETCH_AT = 25;

export interface AnswerRecord {
  question: Question;
  chosen: number;
  correct: boolean;
}

export interface QuizStats {
  answered: number;
  correct: number;
  /** every answer in the order it was given */
  log: AnswerRecord[];
}

export interface QuizHandlers {
  onCorrect: () => void;
  onBatchDone: (correct: number, total: number) => void;
}

/** Fetches question batches (with prefetch) and hands them out one at a time. */
export class QuestionFeed {
  private batch: Question[] = [];
  private next: Question[] | null = null;
  private idx = 0;
  private fetching: Promise<void> | null = null;
  private seen: number[] = [];
  batchCorrect = 0;

  constructor(private category: string, private fetcher = api.questions) {}

  async init() {
    this.batch = await this.fetch();
    this.idx = 0;
  }

  private async fetch(): Promise<Question[]> {
    const qs = await this.fetcher(this.category, BATCH_SIZE, this.seen.slice(-BATCH_SIZE * 2));
    this.seen.push(...qs.map((q) => q.id));
    return qs;
  }

  private prefetch() {
    if (this.next || this.fetching) return;
    this.fetching = this.fetch()
      .then((qs) => {
        this.next = qs;
      })
      .catch(() => {})
      .finally(() => {
        this.fetching = null;
      });
  }

  /** Returns the next question, or null if none available yet. Triggers prefetch/rollover. */
  take(): { q: Question; batchDone?: { correct: number; total: number } } | null {
    if (this.idx >= PREFETCH_AT) this.prefetch();
    if (this.idx >= this.batch.length) {
      const done = { correct: this.batchCorrect, total: this.batch.length };
      if (this.next && this.next.length) {
        this.batch = this.next;
        this.next = null;
        this.idx = 0;
        this.batchCorrect = 0;
        return { q: this.batch[this.idx++], batchDone: done };
      }
      // nothing prefetched yet (tiny bank or slow network): reuse the current batch
      if (this.batch.length) {
        this.idx = 0;
        this.batchCorrect = 0;
        this.prefetch();
        return { q: this.batch[this.idx++], batchDone: done };
      }
      return null;
    }
    return { q: this.batch[this.idx++] };
  }
}

/** DOM quiz panel: renders questions, handles answers with the green/red timing rules. */
export class QuizPanel {
  readonly el: HTMLElement;
  readonly stats: QuizStats = { answered: 0, correct: 0, log: [] };
  private qText: HTMLElement;
  private opts: HTMLButtonElement[] = [];
  private head: HTMLElement;
  private current: Question | null = null;
  private locked = false;
  private stopped = false;

  constructor(private feed: QuestionFeed, private handlers: QuizHandlers) {
    this.el = document.createElement('div');
    this.el.className = 'quiz';
    this.head = document.createElement('div');
    this.head.className = 'q-head';
    this.qText = document.createElement('div');
    this.qText.className = 'q-text';
    const grid = document.createElement('div');
    grid.className = 'options';
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('button');
      b.className = 'opt';
      b.dataset.idx = String(i);
      b.addEventListener('click', () => this.answer(i));
      grid.appendChild(b);
      this.opts.push(b);
    }
    this.el.append(this.head, this.qText, grid);
  }

  start() {
    this.showNext();
  }

  stop() {
    this.stopped = true;
    this.locked = true;
  }

  private showNext() {
    if (this.stopped) return;
    const t = this.feed.take();
    if (!t) {
      this.qText.textContent = '題目載入中…';
      setTimeout(() => this.showNext(), 500);
      return;
    }
    if (t.batchDone) this.handlers.onBatchDone(t.batchDone.correct, t.batchDone.total);
    this.current = t.q;
    this.locked = false;
    this.qText.textContent = t.q.text;
    const acc = this.stats.answered ? Math.round((this.stats.correct / this.stats.answered) * 100) : 0;
    this.head.innerHTML = `<span>第 ${this.stats.answered + 1} 題</span><span>正確率 ${acc}%</span>`;
    const labels = ['A', 'B', 'C', 'D'];
    this.opts.forEach((b, i) => {
      b.className = 'opt';
      b.disabled = false;
      b.innerHTML = `<b>${labels[i]}</b><span>${escapeHtml(t.q.options[i] ?? '')}</span>`;
    });
  }

  private answer(i: number) {
    if (this.locked || !this.current) return;
    this.locked = true;
    const q = this.current;
    this.stats.answered++;
    const ok = i === q.answerIndex;
    this.stats.log.push({ question: q, chosen: i, correct: ok });
    this.opts.forEach((b) => (b.disabled = true));
    if (ok) {
      this.stats.correct++;
      this.feed.batchCorrect++;
      this.opts[i].classList.add('correct');
      this.handlers.onCorrect();
      setTimeout(() => this.showNext(), CORRECT_DELAY_MS);
    } else {
      this.opts[i].classList.add('wrong');
      this.opts[q.answerIndex].classList.add('correct');
      this.opts.forEach((b, k) => {
        if (k !== i && k !== q.answerIndex) b.classList.add('dim');
      });
      setTimeout(() => this.showNext(), WRONG_DELAY_MS);
    }
  }
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
