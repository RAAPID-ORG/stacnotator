import type { AnnotationOut, AnnotationTaskOut, CampaignSettingsOut } from '~/api/client';

export type FormField = NonNullable<CampaignSettingsOut['form_fields']>[number];

export type FormValues = NonNullable<AnnotationOut['form_values']>;

export type TaskStatus = NonNullable<AnnotationTaskOut['task_status']>;
