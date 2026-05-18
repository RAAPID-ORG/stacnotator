import type { LabelBase } from '~/api/client';

// Assigns each campaign label a visually distinct color for the distribution maps .
export const generateLabelColors = (labels: LabelBase[]): Record<number, string> => {
  const colors: Record<number, string> = {};
  const hueStep = 360 / Math.max(labels.length, 1);

  labels.forEach((label, index) => {
    const hue = (index * hueStep) % 360;
    const saturation = 70 + (index % 3) * 10;
    const lightness = 45 + (index % 2) * 10;
    colors[label.id] = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  });

  return colors;
};
