import { z } from 'zod';

/** IPC 返回的本地 Windows 路径不绑定盘符；磁盘权限及实际文件边界仍由 Rust 校验。 */
export const localWindowsPathSchema = z
  .string()
  .min(4)
  .max(32767)
  .regex(/^[a-zA-Z]:[\\/]/u)
  .refine((value) => !/[\p{Cc}<>"|?*]/u.test(value))
  .refine((value) => !value.slice(2).includes(':'))
  .refine((value) =>
    value
      .slice(3)
      .split(/[\\/]/u)
      .some((part) => part.length > 0),
  )
  .refine(
    (value) =>
      !value
        .slice(3)
        .split(/[\\/]/u)
        .some((part) => part === '..'),
  );
