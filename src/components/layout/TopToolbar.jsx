import { useState } from 'react'
import Toolbar from '../Toolbar'

export default function TopToolbar() {
  const [activeTool, setActiveTool] = useState(null)

  return (
    <Toolbar
      activeTool={activeTool}
      onToolSelect={setActiveTool}
    />
  )
}
