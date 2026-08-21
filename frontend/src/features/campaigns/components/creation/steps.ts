/** The campaign creation wizard's steps, per campaign mode. */
export const STEP_CONFIG = {
  tasks: [
    { name: 'Campaign', component: 'StepCampaign' },
    { name: 'Settings', component: 'StepSettings' },
    { name: 'Imagery', component: 'StepImagery' },
    { name: 'Time Series', component: 'StepAddTimeseries' },
    { name: 'Create', component: 'StepReview' },
  ],
  open: [
    { name: 'Campaign', component: 'StepCampaign' },
    { name: 'Settings', component: 'StepSettings' },
    { name: 'Imagery', component: 'StepImagery' },
    { name: 'Time Series', component: 'StepAddTimeseries' },
    { name: 'Create', component: 'StepReview' },
  ],
} as const;
