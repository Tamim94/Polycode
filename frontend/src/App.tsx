import { useState } from 'react'
import ReviewPlayer from './modules/1A-review/ReviewPlayer'
import ZeroTrustPlayer from './modules/2A-zerotrust/ZeroTrustPlayer'
import AIAnalyzer from './modules/3A-ai/AIAnalyzer'
import styles from './App.module.css'

type Tab = '1A' | '2A' | '3A'

export default function App() {
  const [tab, setTab] = useState<Tab>('1A')

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <span className={styles.logo}>Polycode</span>
        <nav className={styles.nav}>
          <button
            className={tab === '1A' ? styles.active : ''}
            onClick={() => setTab('1A')}
          >
            1A — Lecteur de Revue Augmenté
          </button>
          <button
            className={tab === '2A' ? styles.active : ''}
            onClick={() => setTab('2A')}
          >
            2A — Architecture Zéro-Trust
          </button>
          <button
            className={tab === '3A' ? styles.active : ''}
            onClick={() => setTab('3A')}
          >
            3A — IA & Data
          </button>
        </nav>
      </header>

      <main className={styles.main}>
        {tab === '1A' && <ReviewPlayer />}
        {tab === '2A' && <ZeroTrustPlayer />}
        {tab === '3A' && <AIAnalyzer />}
      </main>
    </div>
  )
}
