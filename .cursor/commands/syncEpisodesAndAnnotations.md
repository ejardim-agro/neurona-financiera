# Sync podcast episodes and the defined workflow

## Overview

This command will trigger the execution of several scripts, in order to process new episodes through the defined pipeline:

1. Download the new episode(s)
2. Transcribe it/them
3. Process/rewrite it/them
4. Annotate it/them

## Workflow

[ ] - First, we need to execute the script `syncEpisodes` by running `pnpm run syncEpisodes`.
[ ] - Then, we need to execute the script `syncTranscripts` by running `pnpm run syncTranscripts`.
[ ] - Then, we need to execute the script `syncProcessedFiles` by running `pnpm run syncProcessedFiles`.
[ ] - Finally, we need to execute the script `syncAnnotations` by running `pnpm run syncAnnotations`.
