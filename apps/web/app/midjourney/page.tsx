import { AsyncTaskView } from '../task/async-task-view';

export default function MidjourneyPage() {
  return (
    <AsyncTaskView
      defaultKind="image"
      title="绘图日志"
      subtitle="只展示 kind=image 的真实绘图任务记录；未接入绘图上游时保持空状态。"
    />
  );
}
