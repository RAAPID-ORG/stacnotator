/** The campaign creation wizard's steps, in the order they are walked. */
export const WIZARD_STEPS = [
  { key: 'campaign', component: 'StepCampaign' },
  { key: 'settings', component: 'StepSettings' },
  { key: 'imagery', component: 'StepImagery' },
  { key: 'timeseries', component: 'StepAddTimeseries' },
  { key: 'create', component: 'StepReview' },
] as const;
