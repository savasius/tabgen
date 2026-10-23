import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider } from '@/lib/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Shell } from '@/components/app/Shell'
import { Library } from '@/screens/Library'
import { AddSong } from '@/screens/AddSong'
import { Processing } from '@/screens/Processing'
import { SongLayout, ChordsView } from '@/screens/Song'
import { TabView } from '@/screens/TabView'
import { PlayAlong } from '@/screens/PlayAlong'
import { Tuner } from '@/screens/Tuner'
import { Metronome } from '@/screens/Metronome'
import { Settings } from '@/screens/Settings'

export default function App() {
  return (
    <AppProvider>
      <TooltipProvider>
        <HashRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Library />} />
              <Route path="add" element={<AddSong />} />
              <Route path="processing/:id" element={<Processing />} />
              <Route path="song/:id" element={<SongLayout />}>
                <Route index element={<ChordsView />} />
                <Route path="tab" element={<TabView />} />
                <Route path="play" element={<PlayAlong />} />
              </Route>
              <Route path="tuner" element={<Tuner />} />
              <Route path="metronome" element={<Metronome />} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </HashRouter>
      </TooltipProvider>
    </AppProvider>
  )
}
