import React from 'react'
import ReactDOM from 'react-dom/client'
import { AuthProvider } from '@sim/ui/AuthContext.jsx'
import App from './App.jsx'
import '@sim/ui/base.css'
import './cloud.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
)
