/** Info-card copy. Every statement is taken from the fact sheet in the brief. */
export interface Fact {
  kicker: string;
  title: string;
  lines: string[];
}

export const FACTS: Record<string, Fact> = {
  rocket: {
    kicker: '运载火箭',
    title: '长征十号',
    lines: ['为载人登月研制的新一代载人运载火箭，三级半构型', '全长约 92.5 米，起飞质量约 2189 吨', '起飞推力约 2678 吨', '地月转移轨道运载能力不低于 27 吨', '从海南文昌航天发射场发射', '一次登月任务需要两枚'],
  },
  ship: {
    kicker: '载人飞船',
    title: '梦舟',
    lines: ['新一代载人飞船，登月构型称"梦舟Y"', '两舱构型：返回舱 + 服务舱', '负责地球与环月轨道之间的人员往返', '登月任务可搭载 3 名航天员往返地面与环月轨道', '近地任务可搭载 7 人，兼顾空间站运营', '由飞船承担逃逸救生任务'],
  },
  escapeTower: {
    kicker: '梦舟 · 部件',
    title: '逃逸塔',
    lines: ['位于发射段顶部', '发射阶段有逃逸救生系统，由飞船承担逃逸救生任务', '是"安全兜底"设计的一部分'],
  },
  capsule: {
    kicker: '梦舟 · 部件',
    title: '返回舱',
    lines: ['航天员的座舱和控制中枢', '承担再入大气层与着陆任务', '以接近第二宇宙速度（11.2 千米/秒）再入大气层', '可重复使用'],
  },
  serviceModule: {
    kicker: '梦舟 · 部件',
    title: '服务舱',
    lines: ['为飞船提供能源与动力', '与返回舱一起构成梦舟的两舱构型', '留在环月轨道待命，不必跟随落到月面再抬起来'],
  },
  lander: {
    kicker: '月面着陆器',
    title: '揽月',
    lines: ['由登月舱和推进舱组成', '负责环月轨道与月面之间的往返运输', '可搭载 2 名航天员往返，可携带月球车和科学载荷', '航天员登月后的月面生活中心、能源中心和数据中心'],
  },
  descentStage: {
    kicker: '揽月 · 部件',
    title: '推进舱',
    lines: ['负责近月制动与月面下降的主减速', '位于揽月下部，上部为登月舱'],
  },
  ascentStage: {
    kicker: '揽月 · 部件',
    title: '登月舱',
    lines: ['是航天员的座舱，负责从月面起飞上升', '与梦舟再次交会对接，航天员携月球样品进入梦舟'],
  },
  legs: {
    kicker: '揽月 · 部件',
    title: '着陆腿',
    lines: ['揽月下部：推进舱与着陆腿', '着陆腿触月，软着陆于月面预定区域'],
  },
  suit: {
    kicker: '登月服',
    title: '望宇',
    lines: ['航天员月面出舱活动时穿着'],
  },
  rover: {
    kicker: '载人月球车',
    title: '探索',
    lines: ['航天员在月面驾驶', '开展采样与实验'],
  },
};

export const PART_NAMES: Record<string, string> = {
  escapeTower: '逃逸塔',
  capsule: '返回舱',
  serviceModule: '服务舱',
  descentStage: '推进舱',
  ascentStage: '登月舱',
  legs: '着陆腿',
  lander: '揽月',
  ship: '梦舟',
  rocket: '长征十号',
  suit: '望宇',
  rover: '探索',
};
