const RAW_TRACKS = [
  ['小宇', '张震岳', 'OK'], ['日落大道', 'GALA', '追梦赤子心'], ['夏夜晚风', 'Wu Bai & China Blue', '爱情的尽头'],
  ['我的金桔', '万能青年旅店', '冀西南林路行'], ['秦皇岛', '万能青年旅店', '万能青年旅店'], ['春风十里', '鹿先森乐队', '所有的酒，都不如你'],
  ['南山南', '马頔', '孤岛'], ['平凡之路', '朴树', '猎户星座'], ['清白之年', '朴树', '猎户星座'],
  ['旅行的意义', '陈绮贞', '华丽的冒险'], ['太聪明', '陈绮贞', 'Groupies 吉他手'], ['宝贝', '张悬', 'My Life Will...'],
  ['莉莉安', '宋冬野', '安和桥北'], ['成都', '赵雷', '无法长大'], ['画', '赵雷', '赵小雷'],
  ['空帆船', '朴树', '猎户星座'], ['山丘', '李宗盛', '既然青春留不住'], ['给自己的歌', '李宗盛', '南下专线'],
  ['温柔', '五月天', '爱情万岁'], ['人生海海', '五月天', '人生海海'], ['如烟', '五月天', '后青春期的诗'],
  ['司机', '陈绮贞', '华丽的冒险'], ['米店', '张玮纶', '车站'], ['春天里', '汪峰', '信仰在空中飘扬'],
  ['一万次悲伤', '逃跑计划', '世界'], ['夜空中最亮的星', '逃跑计划', '世界'], ['北京北京', '汪峰', '勇敢的心'],
  ['天空', '王菲', '天空'], ['红豆', '王菲', '唱游'], ['棋子', '王菲', '天空'],
  ['年少有为', '李荣浩', '耳朵'], ['喜剧之王', '李荣浩', '李荣浩'], ['模特', '李荣浩', '模特'],
  ['慢慢喜欢你', '莫文蔚', '我们在中场相遇'], ['忽然之间', '莫文蔚', '就是莫文蔚'], ['盛夏的果实', '莫文蔚', '十二楼的莫文蔚'],
  ['Yellow', 'Coldplay', 'Parachutes'], ['Sparks', 'Coldplay', 'Parachutes'], ['Paradise', 'Coldplay', 'Mylo Xyloto'],
  ['Dreams', 'The Cranberries', 'Everybody Else Is Doing It'], ['Sunday Morning', 'Maroon 5', 'Songs About Jane'], ['Put Your Records On', 'Corinne Bailey Rae', 'Corinne Bailey Rae'],
  ['Budapest', 'George Ezra', 'Wanted on Voyage'], ['Riptide', 'Vance Joy', 'Dream Your Life Away'], ['Home', 'Edward Sharpe & The Magnetic Zeros', 'Up from Below'],
  ['Wake Me Up', 'Avicii', 'True'], ['Sunset Lover', 'Petit Biscuit', 'Presence'], ['Walking on a Dream', 'Empire of the Sun', 'Walking on a Dream'],
  ['Holocene', 'Bon Iver', 'Bon Iver'], ['Bloom', 'The Paper Kites', 'Woodland'], ['Anchor', 'Novo Amor', 'Bathing Beach'],
  ['Mystery of Love', 'Sufjan Stevens', 'Call Me by Your Name'], ['Flightless Bird, American Mouth', 'Iron & Wine', 'The Shepherd’s Dog'], ['Heartbeats', 'José González', 'Veneer'],
  ['Sweet Disposition', 'The Temper Trap', 'Conditions'], ['Mountain Sound', 'Of Monsters and Men', 'My Head Is an Animal'], ['Young Folks', 'Peter Bjorn and John', "Writer's Block"],
  ['Electric Feel', 'MGMT', 'Oracular Spectacular'], ['Midnight City', 'M83', 'Hurry Up, We’re Dreaming'], ['A Moment Apart', 'ODESZA', 'A Moment Apart'],
];

const DEMO_AUDIO = [
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
];

const DEMO_CATALOG = RAW_TRACKS.map(([title, artist, album], index) => ({
  id: `demo-${String(index + 1).padStart(3, '0')}`,
  title,
  artist,
  album,
  durationMs: null,
  coverUrl: null,
  previewUrl: DEMO_AUDIO[index % DEMO_AUDIO.length],
  provider: 'demo',
  accent: `hsl(${(index * 37 + 18) % 360} 52% 48%)`,
}));

module.exports = { DEMO_CATALOG };
