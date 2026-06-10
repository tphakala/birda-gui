import { ipcMain } from 'electron';
import { listAnnotations, upsertAnnotation, deleteAnnotation } from '../db/annotations';
import type { AnnotationInput } from '$shared/types';

export function registerAnnotationHandlers(): void {
  ipcMain.handle('annotations:list', (_event, audioFileId: number) => {
    return listAnnotations(audioFileId);
  });

  ipcMain.handle('annotations:upsert', (_event, input: AnnotationInput) => {
    return upsertAnnotation(input);
  });

  ipcMain.handle('annotations:delete', (_event, id: number) => {
    deleteAnnotation(id);
  });
}
