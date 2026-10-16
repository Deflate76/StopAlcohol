export const DIRECTIONS = {up:{x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0}};
export function placeFood(body, size, random = Math.random) {
    const occupied = new Set(body.map(p => p.y * size + p.x)), free = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!occupied.has(y * size + x)) free.push({x,y});
    return free.length ? free[Math.min(free.length-1, Math.max(0, Math.floor(random() * free.length)))] : null;
}
export function createSnake(size = 20, random = Math.random) {
    const center = Math.floor(size/2), body = [{x:center,y:center},{x:center-1,y:center},{x:center-2,y:center}];
    return {size, body, direction:'right', queue:[], food:placeFood(body,size,random), score:0, state:'playing'};
}
export function turnSnake(game, direction) {
    if (game.state !== 'playing' || !DIRECTIONS[direction] || game.queue.length >= 2) return false;
    const last = game.queue.at(-1) || game.direction, a = DIRECTIONS[last], b = DIRECTIONS[direction];
    if (last === direction || (a.x + b.x === 0 && a.y + b.y === 0)) return false;
    game.queue.push(direction); return true;
}
export function stepSnake(game, random = Math.random) {
    if (game.state !== 'playing') return game;
    game.direction = game.queue.shift() || game.direction;
    const delta = DIRECTIONS[game.direction], head = {x:game.body[0].x+delta.x, y:game.body[0].y+delta.y};
    const eat = !!game.food && head.x === game.food.x && head.y === game.food.y;
    const occupied = eat ? game.body : game.body.slice(0,-1);
    if (head.x < 0 || head.y < 0 || head.x >= game.size || head.y >= game.size || occupied.some(p => p.x === head.x && p.y === head.y)) {
        game.state = 'over'; return game;
    }
    game.body.unshift(head);
    if (eat) {game.score += 10; game.food = placeFood(game.body,game.size,random); if (!game.food) game.state = 'won';}
    else game.body.pop();
    return game;
}
