/**
 * THE HOST ENVIRONMENT RECORD SCHEMA.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The five candidates are compared on latency, tokens per second and context
 * utilisation, and every one of those numbers is a property of the MACHINE as
 * much as of the model. A model benchmarked while another application held two
 * gigabytes of VRAM, or while the runtime spilled half its weights into system
 * RAM, produces slower numbers that say nothing about the model. An unfair
 * comparison of that kind is invisible in the results file unless the conditions
 * were recorded at the time, because they cannot be reconstructed afterwards.
 *
 * So this schema is the contract for one file per model per run, carrying a
 * TIMESTAMPED SERIES of host readings plus the offload split the local runtime
 * reported. A single reading would not be enough: the interesting failures are
 * transient - a spike in GPU utilisation from another process, free RAM falling
 * during a long run - and a single number cannot show a spike.
 *
 * WHO WRITES IT: NOT THIS HARNESS
 * ---------------------------------------------------------------------------
 * An EXTERNAL host sampler writes these files. Nothing in `src/eval` samples the
 * machine, shells out to `nvidia-smi`, or reads `/proc`. The harness runs inside
 * a container and would measure the container, not the host whose GPU is doing
 * the work; and `npm run eval:report` is required to be a pure function of what
 * is already on disk. This module therefore only ever READS and VALIDATES.
 *
 * STRICT ON MALFORMED, SILENT ON MISSING
 * ---------------------------------------------------------------------------
 * A file that exists must be complete and well-formed, and a file that is not
 * fails LOUDLY - because a half-read environment record is worse than none at
 * all: it would let a wrong number into a fairness argument. But a MISSING file
 * is a normal, expected state. Not every run is sampled, and the report prints
 * `not measured` for an unsampled model rather than treating it as an error.
 *
 * Every measurement field is REQUIRED and NULLABLE rather than optional. A
 * sampler that could not read a quantity must say `null` and be explicit about
 * it; a sampler that omits the key has a bug, and this schema calls it.
 *
 * UNITS ARE IN THE FIELD NAMES
 * ---------------------------------------------------------------------------
 * Every numeric field names its unit (`...Bytes`, `...Percent`). A number whose
 * unit a reader has to guess is a fabrication risk: `vramUsed: 5491` is either
 * 5.5 GB or 5.4 GiB or a misread MiB figure, and nothing in the file says which.
 */
import { z } from 'zod';

/**
 * Bump when the shape or the semantics of a field change, exactly as
 * `CORPUS_SCHEMA_VERSION` and `SchedulingPolicyDocumentSchema`'s `version` do.
 * The literal below means an older or newer record is REJECTED rather than
 * partially understood.
 */
export const ENVIRONMENT_RECORD_SCHEMA_VERSION = '1.0.0';

/** Byte counts are whole, non-negative numbers or an explicit `null`. */
const ByteCount = z.number().int().min(0);

/** A utilisation or load reading, 0-100. Outside that range is a unit error. */
const PercentReading = z.number().min(0).max(100);

/**
 * ONE READING, AT ONE INSTANT.
 *
 * All five quantities are independently nullable because samplers differ in what
 * they can see: a host without `nvidia-smi` on the path can still report free
 * RAM and CPU load, and reporting those while saying `null` for the GPU is more
 * useful than refusing to write a file at all.
 */
export const EnvironmentSampleSchema = z
  .object({
    /** When this reading was taken. ISO 8601, UTC. */
    atIso: z.string().datetime(),
    /** Free (not merely available-after-reclaim) host system RAM, in bytes. */
    freeSystemRamBytes: ByteCount.nullable(),
    /** VRAM in use across the whole device, by every process, in bytes. */
    vramUsedBytes: ByteCount.nullable(),
    /** Total VRAM the device reports, in bytes. */
    vramTotalBytes: ByteCount.nullable(),
    /** GPU busy percentage, 0-100, as the driver reports it. */
    gpuUtilizationPercent: PercentReading.nullable(),
    /** Host CPU busy percentage across all logical cores, 0-100. */
    cpuLoadPercent: PercentReading.nullable(),
  })
  .strict()
  .superRefine((sample, ctx) => {
    // Used VRAM above total VRAM is not a bad reading, it is a unit mix-up -
    // MiB into one field and bytes into the other. Caught here rather than
    // silently producing a fairness claim built on it.
    if (
      sample.vramUsedBytes !== null &&
      sample.vramTotalBytes !== null &&
      sample.vramUsedBytes > sample.vramTotalBytes
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vramUsedBytes'],
        message:
          `vramUsedBytes (${sample.vramUsedBytes}) exceeds vramTotalBytes (${sample.vramTotalBytes}). ` +
          'Both fields are BYTES - this is usually a MiB-for-bytes mix-up in the sampler.',
      });
    }
  });

export type EnvironmentSample = z.infer<typeof EnvironmentSampleSchema>;

/**
 * HOW MUCH OF THE MODEL WAS ON THE GPU, AND HOW MUCH WAS NOT.
 *
 * This is the single number that explains an unfair comparison. A model that
 * fits entirely in VRAM and a model that spilled thirty percent of its layers
 * into system RAM are not competing on the same terms, and the second one's
 * latency describes the spill rather than the model. Ollama reports this as
 * `size` versus `size_vram` on `/api/ps`, and prints it as `100% GPU` or
 * `42%/58% CPU/GPU`.
 */
export const OffloadSplitSchema = z
  .object({
    /** Which local runtime said so, e.g. `ollama 0.34.3 /api/ps`. */
    reportedBy: z.string().min(1),
    /** Bytes of this model resident on the GPU. */
    gpuBytes: ByteCount.nullable(),
    /** Bytes of this model resident in host RAM instead. Zero is a real value. */
    cpuBytes: ByteCount.nullable(),
    /**
     * The runtime's own words, verbatim, e.g. `100% GPU`.
     *
     * Kept next to the derived bytes so a reader can check the arithmetic
     * against what the tool actually printed instead of trusting this file's
     * interpretation of it.
     */
    runtimeReportedText: z.string().min(1).nullable(),
  })
  .strict();

export type OffloadSplit = z.infer<typeof OffloadSplitSchema>;

/**
 * ONE FILE PER MODEL PER RUN.
 *
 * `runId` and `modelId` are both recorded IN the file and not left implicit in
 * its path, so a record that is copied, moved or attributed to the wrong model
 * can be caught. `readEnvironmentRecord` checks the `modelId` against the model
 * it was looked up under and refuses a mismatch: silently crediting one model's
 * conditions to another is the exact failure this whole file exists to prevent.
 */
export const EnvironmentRecordSchema = z
  .object({
    schemaVersion: z.literal(ENVIRONMENT_RECORD_SCHEMA_VERSION),
    /** The Ollama tag, exactly as the candidate set spells it. */
    modelId: z.string().min(1),
    /**
     * Which benchmark run this describes. Free-form but must be identical
     * across the five files of one sequential sweep, because that is what makes
     * them a comparison rather than five unrelated measurements.
     */
    runId: z.string().min(1),
    /**
     * The context length the run used.
     *
     * Recorded because the fairness protocol requires an IDENTICAL `num_ctx`
     * for all five candidates - the KV cache is a real part of the VRAM
     * footprint - and a reader should be able to verify that from the evidence
     * rather than take it on trust.
     */
    numCtx: z.number().int().min(1).nullable(),
    /** The external sampler that wrote this file, with its version. */
    sampledBy: z.string().min(1),
    startedAtIso: z.string().datetime(),
    endedAtIso: z.string().datetime(),
    /**
     * The series. At least one sample: a record claiming to be a measurement
     * and containing none is malformed, not empty.
     */
    samples: z.array(EnvironmentSampleSchema).min(1),
    /** The model's own resident size in bytes, weights plus KV cache. */
    modelResidentBytes: ByteCount.nullable(),
    /** Null when the runtime did not report a split, not when it was 100% GPU. */
    offload: OffloadSplitSchema.nullable(),
    /**
     * FREE TEXT, for the conditions no schema can anticipate: another GPU
     * application open, a laptop on battery, a thermal throttle, a driver
     * upgrade between models. Explicitly `null` when there is nothing to say.
     */
    note: z.string().nullable(),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (Date.parse(record.endedAtIso) < Date.parse(record.startedAtIso)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endedAtIso'],
        message: `endedAtIso (${record.endedAtIso}) precedes startedAtIso (${record.startedAtIso}).`,
      });
    }
  });

export type EnvironmentRecord = z.infer<typeof EnvironmentRecordSchema>;

/**
 * Validate, or throw with everything a reader needs to fix the file.
 *
 * `source` is the path (or a label, in a test) and is quoted into the message,
 * because "a malformed environment record" without saying which one is not an
 * actionable error when five files are involved.
 */
export function parseEnvironmentRecord(raw: unknown, source: string): EnvironmentRecord {
  const result = EnvironmentRecordSchema.safeParse(raw);
  if (result.success) return result.data;

  const issues = result.error.issues
    .map((issue) => `  - ${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('\n');

  throw new Error(
    `Malformed environment record at ${source}.\n${issues}\n\n` +
      `Expected schemaVersion "${ENVIRONMENT_RECORD_SCHEMA_VERSION}". Every measurement field is REQUIRED ` +
      'and may be null, but may not be omitted. A MISSING file is fine and reports `not measured`; a ' +
      'malformed one is not, because a partly-read record could put a wrong number into a fairness claim.',
  );
}
