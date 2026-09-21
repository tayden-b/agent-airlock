import type { ProviderName } from "@/contracts";
import type { Classifier } from "./types";
import { jevClassifier } from "./jev";
import { rulesClassifier } from "./rules";

/** Provider registry; ingestion runs `config.classifier.providers` in order. */
export const CLASSIFIERS: Record<ProviderName, Classifier> = {
  rules: rulesClassifier,
  jev: jevClassifier,
};
