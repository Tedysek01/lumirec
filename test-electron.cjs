const e = require('electron')
console.log('typeof electron:', typeof e)
if (typeof e === 'string') {
  console.log('Got binary path string - interception NOT working!')
  console.log('path:', e)
} else {
  console.log('Got electron object - interception working!')
  console.log('ipcMain:', typeof e.ipcMain)
  console.log('app:', typeof e.app)
}
