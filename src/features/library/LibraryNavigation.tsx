import { NavLink } from 'react-router-dom';
import { faSteam } from '@fortawesome/free-brands-svg-icons';
import { faGamepad } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@/features/home/components/Icon';
/** 独立路由使刷新和导航收藏都能精确回到“其他游戏”。 */
export function LibraryNavigation() {
  return (
    <nav className="library-secondary glass" aria-label="游戏库分类">
      <NavLink to="/library" end>
        <Icon icon={faSteam} />
        Steam 游戏
      </NavLink>
      <NavLink to="/library/other">
        <Icon icon={faGamepad} />
        其他游戏
      </NavLink>
    </nav>
  );
}
