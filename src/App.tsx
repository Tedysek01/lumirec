import { useEffect, useState } from "react";
import { LaunchWindow } from "./components/launch/LaunchWindow";
import { SourceSelector } from "./components/launch/SourceSelector";
import VideoEditor from "./components/video-editor/VideoEditor";
import { loadAllCustomFonts } from "./lib/customFonts";

export default function App() {
  const [windowType, setWindowType] = useState('');

  useEffect(() => {
    // Activate dark mode for sketch theme
    document.documentElement.classList.add('dark');

    const params = new URLSearchParams(window.location.search);
    const type = params.get('windowType') || '';
    setWindowType(type);
    if (type === 'hud-overlay' || type === 'source-selector') {
      document.body.style.background = 'transparent';
      document.documentElement.style.background = 'transparent';
      document.getElementById('root')?.style.setProperty('background', 'transparent');
    }

    // Load custom fonts on app initialization
    loadAllCustomFonts().catch((error) => {
      console.error('Failed to load custom fonts:', error);
    });
  }, []);

  return (
    <>
      {(() => {
        switch (windowType) {
          case 'hud-overlay':
            return <LaunchWindow />;
          case 'source-selector':
            return <SourceSelector />;
          case 'editor':
            return <VideoEditor />;
          default:
            return (
              <div className="w-full h-full bg-background text-foreground font-sans flex items-center justify-center">
                <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">Lumirec</h1>
              </div>
            );
        }
      })()}
    </>
  );
}
