import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * CSS 类名合并工具函数
 * 使用 clsx 处理条件类名，再用 twMerge 解决 Tailwind CSS 类名冲突
 * @param inputs 类名输入（支持字符串、对象、数组等格式）
 * @returns 合并后的类名字符串
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
