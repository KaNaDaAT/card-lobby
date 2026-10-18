import './styles/tokens.css';
import './styles/app.css';
import { startRouter } from './ui/router';
import { renderHome } from './ui/screens/home';
import { renderLobby } from './ui/screens/lobby';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app element');

startRouter(root, { home: renderHome, room: renderLobby });
