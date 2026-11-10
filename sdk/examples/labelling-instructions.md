# Labelling instructions

<!--
Template for `stacnotator-label run --instructions <file>`. This file is the only source of
labelling rules the model gets: write everything a trained photo-interpreter would need to
label this campaign the way you want. The model already knows how the tools and views work
and gets the campaign's labels (with their ids), form fields and imagery list, so refer to
labels and imagery by their names. Replace every section; delete the ones you do not need.
-->

## Task

What one task is, what period it is about, and what question the label answers.

## Classes

One entry per label: its exact name, a definition, what it looks like in the imagery and the
time series over the season, and the classes it is easily confused with and how to tell them
apart.

## Decision rules

The order to decide in, thresholds that apply (area shares, dates, durations), and how to
handle mixed or edge cases inside the sample extent.

## Evidence

Which imagery and time series to rely on for what, which visualizations help, which zoom
levels are useful, and what never counts as evidence.

## When to skip or flag

When the imagery cannot tell and the task must be skipped, and when a label should be
flagged for a person to check.

## Confidence

What each confidence level from 0 to 5 means for this campaign.

## Form fields

How to fill each form field, if the campaign has any.
