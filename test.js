// test-yt-dlp-playlist.js
const YtDlpWrap = require('yt-dlp-wrap').default;

const ytDlpWrap = new YtDlpWrap();

const playlistUrl = 'https://www.youtube.com/watch?v=xNPhG8zzNFA&list=RDMM&index=2';

// Pass flags first, then URL last
ytDlpWrap.getVideoInfo(['--yes-playlist', '--playlist-end', '3', playlistUrl])
  .then(info => {
    console.log('Full info object:', info); // Debug entire response

    if (Array.isArray(info.entries)) {
      console.log('✅ Playlist Info Fetched Successfully!');
      console.log('Playlist title:', info.title || 'No title');
      console.log('Number of videos in playlist (limited):', info.entries.length);
      console.log('Videos:');
      info.entries.forEach((video, i) => {
        console.log(`${i + 1}. ${video.title || 'No title'} (id: ${video.id || 'No id'})`);
      });
    } else {
      console.log('✅ Single Video Info Fetched:');
      console.log('Title:', info.title || 'No title');
    }
  })
  .catch(err => {
    console.error('❌ Failed to fetch playlist info:', err);
  });
