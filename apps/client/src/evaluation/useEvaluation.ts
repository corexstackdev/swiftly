import { useCallback, useEffect, useRef, useState } from 'react';
import type { EvaluationMap } from '@swiftly/shared';
import type { EvaluateRequest, EvaluateResponse } from './worker';

/**
 * Owns the evaluation worker's lifecycle.
 *
 * The watchdog is the important part: if a result does not come back within the
 * budget, the expression is assumed to be looping and the worker is terminated and
 * replaced. Without that, one bad binding bricks the editor until a page reload.
 */

const EVALUATION_TIMEOUT_MS = 5_000;

export interface EvaluationState {
  evaluated: EvaluationMap;
  cycles: string[][];
  /** Last evaluation duration, surfaced in the editor's status bar. */
  durationMs: number;
  recomputed: number;
  timedOut: boolean;
}

export function useEvaluation(): {
  state: EvaluationState;
  evaluate: (
    dataTree: Record<string, unknown>,
    bindings: Record<string, unknown>,
    changedPaths?: string[],
  ) => void;
} {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<EvaluateRequest | null>(null);

  const [state, setState] = useState<EvaluationState>({
    evaluated: {},
    cycles: [],
    durationMs: 0,
    recomputed: 0,
    timedOut: false,
  });

  const spawn = useCallback((): Worker => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = (event: MessageEvent<EvaluateResponse>) => {
      if (event.data.type !== 'result') return;
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      setState({
        evaluated: event.data.evaluated,
        cycles: event.data.cycles,
        durationMs: event.data.durationMs,
        recomputed: event.data.recomputed,
        timedOut: false,
      });
    };

    workerRef.current = worker;
    return worker;
  }, []);

  useEffect(() => {
    const worker = spawn();
    return () => {
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      worker.terminate();
      workerRef.current = null;
    };
  }, [spawn]);

  const evaluate = useCallback(
    (
      dataTree: Record<string, unknown>,
      bindings: Record<string, unknown>,
      changedPaths?: string[],
    ) => {
      const worker = workerRef.current;
      if (!worker) return;

      const request: EvaluateRequest = {
        type: 'evaluate',
        requestId: ++requestIdRef.current,
        dataTree,
        bindings,
        ...(changedPaths ? { changedPaths } : {}),
      };
      pendingRef.current = request;

      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      watchdogRef.current = setTimeout(() => {
        // Assume a runaway expression: kill the worker, restart it, and report the
        // timeout rather than leaving the editor silently stale.
        worker.terminate();
        spawn();
        setState((previous) => ({ ...previous, timedOut: true }));
      }, EVALUATION_TIMEOUT_MS);

      worker.postMessage(request);
    },
    [spawn],
  );

  return { state, evaluate };
}
