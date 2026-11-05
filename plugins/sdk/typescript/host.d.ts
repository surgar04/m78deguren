/** WIT 导入只存在于组件运行环境中；此声明不创建浏览器或 Node 的权限入口。 */
/** WIT 生成接口的类型声明；运行时绑定由组件链接器提供，此文件不实现任何宿主能力。 */
declare module 'zhenjing:plugin/capabilities@1.0.0' {
  export function call(request: string): string;
}
