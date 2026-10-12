import { createContext, useContext } from "react";

export interface StepContextValue {
  /** Short id of the selected step (`?step=`), if any. */
  activeStep: string | null;
  pick(stepId: string): void;
}

export const StepContext = createContext<StepContextValue>({ activeStep: null, pick: () => {} });
export const useStepContext = () => useContext(StepContext);
