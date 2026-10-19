import './styles/tokens.css';
import './styles/app.css';
import { startRouter } from './ui/router';
import { renderHome } from './ui/screens/home';
import { renderRoom } from './ui/screens/room';
import { listenForAudioUnlock } from './ui/sound';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app element');

listenForAudioUnlock();
startRouter(root, { home: renderHome, room: renderRoom });
