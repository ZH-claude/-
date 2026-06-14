import { AsyncTaskView } from './async-task-view';

export default function TaskPage() {
  return (
    <AsyncTaskView
      title="异步任务"
      subtitle="展示当前账户已记录的真实异步任务；没有上游任务记录时保持空状态。"
    />
  );
}
