import { validateAppData } from "../todo/todoRepository.js";

const BACKUP_FORMAT = "daily-tool-backup";

export class BackupFormatError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "BackupFormatError";
  }
}

export function createBackupJson(data, exportedAt = new Date()) {
  const validatedData = validateAppData(data);
  if (!validatedData) {
    throw new BackupFormatError("現在のデータ形式が正しくないため、バックアップを作成できません。");
  }
  if (!(exportedAt instanceof Date) || Number.isNaN(exportedAt.valueOf())) {
    throw new BackupFormatError("バックアップ日時が正しくありません。");
  }

  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: exportedAt.toISOString(),
      data: validatedData,
    },
    null,
    2,
  );
}

export function parseBackupJson(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch (cause) {
    throw new BackupFormatError("JSONを読み取れません。ファイルの内容を確認してください。", {
      cause,
    });
  }

  if (backup?.format !== BACKUP_FORMAT || backup.version !== 1) {
    throw new BackupFormatError("Daily-toolのJSONバックアップではありません。");
  }

  const data = validateAppData(backup.data);
  if (!data) {
    throw new BackupFormatError("バックアップ内のデータ形式が正しくありません。");
  }
  return data;
}
