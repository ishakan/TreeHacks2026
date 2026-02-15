import Sidebar from '../Sidebar'
import ImportsPanel from '../ImportsPanel'
import { FeatureEditor } from '../FeatureTree'

export default function RightDock() {
  return (
    <aside className="w-64 flex flex-col border-l border-gray-700 bg-gray-800">
      <div className="border-b border-gray-700">
        <FeatureEditor />
      </div>
      <div className="border-b border-gray-700">
        <ImportsPanel />
      </div>
      <Sidebar />
    </aside>
  )
}
