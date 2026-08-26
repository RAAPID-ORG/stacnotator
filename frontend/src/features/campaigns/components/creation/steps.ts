/** The campaign creation wizard's steps, in the order they are walked. */
export const WIZARD_STEPS = [
  { name: 'Campaign', component: 'StepCampaign' },
  { name: 'Settings', component: 'StepSettings' },
  { name: 'Imagery', component: 'StepImagery' },
  { name: 'Time Series', component: 'StepAddTimeseries' },
  { name: 'Access', component: 'StepAccess' },
  { name: 'Create', component: 'StepReview' },
] as const;

export const WIZARD_STEP_NAMES = WIZARD_STEPS.map((s) => s.name);
