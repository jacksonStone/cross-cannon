import { audioAlignmentPolicies } from "./audio-alignment-policies";
import { runChapterAudioAlignment } from "./lib/audio-alignment";

await runChapterAudioAlignment(process.argv.slice(2), audioAlignmentPolicies);
