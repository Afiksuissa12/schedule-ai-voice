/**
 * Reducing a series of host samples to the three numbers a fairness argument
 * needs: MIN, MEDIAN and MAX.
 *
 * WHY THESE THREE AND NOT A MEAN
 * ---------------------------------------------------------------------------
 * A mean hides exactly the thing this measurement exists to catch. If another
 * GPU application woke up for thirty seconds in the middle of a model's run, the
 * mean absorbs it and the run looks clean; the MAX shows it. If free RAM fell
 * steadily until the runtime started spilling, the mean looks comfortable; the
 * MIN shows it. The median is here as the representative reading precisely
 * because it is the one a single spike cannot move, so median-versus-max is
 * itself the signal.
 *
 * THE ONE RULE THIS FILE INHERITS FROM `report.ts`: NOTHING IS INVENTED.
 * A quantity with no readings is `null` and prints `not measured`. It is never
 * `0`, never a mean of an empty set, and never carried over from another model.
 */
import type { EnvironmentRecord, OffloadSplit } from './schema.js';

/** The label the report prints wherever a quantity was not sampled. */
export const NOT_MEASURED = 'not measured';

/**
 * The quantities a host sampler records, declared ONCE.
 *
 * Table headers, JSON keys and the `notMeasured` list are all derived from this
 * array, so a quantity cannot be added to the schema and quietly missed by the
 * report, and a header cannot drift away from the field it labels.
 */
export const ENVIRONMENT_QUANTITIES = [
  {
    key: 'freeSystemRamBytes',
    label: 'Free system RAM',
    /** How the markdown renders it. The JSON always keeps the raw unit. */
    display: 'gib',
    header: 'Free RAM (GiB)',
  },
  { key: 'vramUsedBytes', label: 'VRAM used (whole device)', display: 'gib', header: 'VRAM used (GiB)' },
  { key: 'vramTotalBytes', label: 'VRAM total', display: 'gib', header: 'VRAM total (GiB)' },
  { key: 'gpuUtilizationPercent', label: 'GPU utilisation', display: 'percent', header: 'GPU util (%)' },
  { key: 'cpuLoadPercent', label: 'CPU load', display: 'percent', header: 'CPU load (%)' },
] as const;

export type EnvironmentQuantityKey = (typeof ENVIRONMENT_QUANTITIES)[number]['key'];

/**
 * Min, median and max over the readings that EXIST.
 *
 * `n` is the number of non-null readings and is reported alongside, because
 * "median 4.1 GiB" over two samples and over two hundred are different claims.
 */
export interface Spread {
  readonly n: number;
  readonly min: number | null;
  readonly median: number | null;
  readonly max: number | null;
}

/** A quantity nobody sampled. Exported so callers cannot spell it as zeroes. */
export const NO_SPREAD: Spread = { n: 0, min: null, median: null, max: null };

/**
 * Nulls are DROPPED rather than counted as zero.
 *
 * A sampler that could not read GPU utilisation reports `null`; treating that as
 * 0% would manufacture an idle GPU out of a missing instrument.
 */
export function spread(values: ReadonlyArray<number | null>): Spread {
  const present = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (present.length === 0) return NO_SPREAD;

  return {
    n: present.length,
    min: present[0] ?? null,
    median: medianOfSorted(present),
    max: present[present.length - 1] ?? null,
  };
}

/**
 * The median of an already-sorted, non-empty list.
 *
 * EVEN COUNT IS THE MEAN OF THE TWO MIDDLE VALUES, which is the ordinary
 * definition and is stated here because the alternative - taking the upper
 * middle - would silently bias every even-length series upward, and a run
 * sampled every ten seconds has an even count about half the time.
 */
function medianOfSorted(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (lower === undefined || upper === undefined) return null;
  return (lower + upper) / 2;
}

/**
 * The offload split as the report consumes it.
 *
 * `gpuPercent` is DERIVED from the two byte counts and only when both are
 * present - not from `modelResidentBytes`, so that the percentage and the bytes
 * it came from are visibly the same arithmetic and a reader can check it.
 */
export interface OffloadSummary {
  readonly reportedBy: string;
  readonly gpuBytes: number | null;
  readonly cpuBytes: number | null;
  readonly gpuPercent: number | null;
  readonly runtimeReportedText: string | null;
}

export interface EnvironmentSummary {
  readonly modelId: string;
  /** False when no host sampler wrote a record for this model's run. */
  readonly recordPresent: boolean;
  readonly runId: string | null;
  readonly numCtx: number | null;
  readonly sampledBy: string | null;
  readonly sampleCount: number;
  readonly firstSampleIso: string | null;
  readonly lastSampleIso: string | null;
  readonly quantities: Record<EnvironmentQuantityKey, Spread>;
  readonly modelResidentBytes: number | null;
  readonly offload: OffloadSummary | null;
  readonly note: string | null;
  /**
   * Which quantities print `not measured`, listed explicitly.
   *
   * Machine readers get this instead of having to infer "was not sampled" from a
   * `null` that could equally have meant "the field is new". It is the JSON
   * counterpart of the `not measured` cell in COMPARISON.md.
   */
  readonly notMeasured: readonly EnvironmentQuantityKey[];
}

/** An absent record summarised honestly: present=false and every spread empty. */
export function summariseEnvironment(modelId: string, record: EnvironmentRecord | null): EnvironmentSummary {
  if (record === null) {
    return {
      modelId,
      recordPresent: false,
      runId: null,
      numCtx: null,
      sampledBy: null,
      sampleCount: 0,
      firstSampleIso: null,
      lastSampleIso: null,
      quantities: emptyQuantities(),
      modelResidentBytes: null,
      offload: null,
      note: null,
      notMeasured: ENVIRONMENT_QUANTITIES.map((q) => q.key),
    };
  }

  const quantities = {} as Record<EnvironmentQuantityKey, Spread>;
  for (const quantity of ENVIRONMENT_QUANTITIES) {
    quantities[quantity.key] = spread(record.samples.map((sample) => sample[quantity.key]));
  }

  const timestamps = record.samples.map((sample) => sample.atIso).sort();

  return {
    modelId,
    recordPresent: true,
    runId: record.runId,
    numCtx: record.numCtx,
    sampledBy: record.sampledBy,
    sampleCount: record.samples.length,
    firstSampleIso: timestamps[0] ?? null,
    lastSampleIso: timestamps[timestamps.length - 1] ?? null,
    quantities,
    modelResidentBytes: record.modelResidentBytes,
    offload: record.offload === null ? null : summariseOffload(record.offload),
    note: record.note,
    notMeasured: ENVIRONMENT_QUANTITIES.filter((q) => quantities[q.key].n === 0).map((q) => q.key),
  };
}

function summariseOffload(offload: OffloadSplit): OffloadSummary {
  const { gpuBytes, cpuBytes } = offload;
  // Both parts must be present: a percentage from one of them would be a guess
  // about the other. And a total of zero yields null rather than a 0/0.
  const total = gpuBytes !== null && cpuBytes !== null ? gpuBytes + cpuBytes : null;

  return {
    reportedBy: offload.reportedBy,
    gpuBytes,
    cpuBytes,
    gpuPercent: total !== null && total > 0 && gpuBytes !== null ? (gpuBytes / total) * 100 : null,
    runtimeReportedText: offload.runtimeReportedText,
  };
}

function emptyQuantities(): Record<EnvironmentQuantityKey, Spread> {
  const quantities = {} as Record<EnvironmentQuantityKey, Spread>;
  for (const quantity of ENVIRONMENT_QUANTITIES) quantities[quantity.key] = NO_SPREAD;
  return quantities;
}
