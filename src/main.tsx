import { render } from 'preact';
import { App } from './App';
import './styles.css';
import { startUpdates } from './updates';

startUpdates();

render(<App />, document.getElementById('app')!);
