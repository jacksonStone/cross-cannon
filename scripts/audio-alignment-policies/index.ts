import type { AlignmentPolicy } from "../lib/audio-alignment";

import { cityOfGodAlignmentPolicy } from "./city-of-god";
import { confessionsAlignmentPolicy } from "./confessions";
import { firstClementAlignmentPolicy } from "./first-clement";

export const audioAlignmentPolicies: AlignmentPolicy[] = [
  cityOfGodAlignmentPolicy,
  confessionsAlignmentPolicy,
  firstClementAlignmentPolicy
];
