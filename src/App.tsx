import {
  SetStateAction,
  Dispatch,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import "./App.css";

function getRandomInt(min: number, max: number) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clampAndWrap(number: number, min: number, max: number): number {
  if (number < min) {
    return max - ((min - number) % (max - min));
  } else if (number > max) {
    return min + ((number - max) % (max - min));
  } else {
    return number;
  }
}

function arePositionsEqual(p1: Position, p2: Position): boolean {
  return p1[0] === p2[0] && p1[1] === p2[1];
}

const CELL_SIZE = 24;
const WIDTH = 50;
const HEIGHT = 30;

function useGameLoop(
  update: (lastFrameDiff: number) => void,
): [boolean, Dispatch<SetStateAction<boolean>>, number] {
  const [paused, setPaused] = useState(true);
  // const [_, setFrameCount] = useState<number>(0);
  const frameCount = useRef(0);
  const lastRenderTime = useRef(0);
  const lastFrameTime = useRef(0);
  const elapsed = useRef(0);
  const fps = useRef(0);

  useEffect(() => {
    let id: number;

    function runFrame(time: number) {
      frameCount.current += 1;
      lastFrameTime.current = time - lastRenderTime.current;
      lastRenderTime.current = time;
      elapsed.current += lastFrameTime.current;

      if (elapsed.current >= 100) {
        fps.current = Math.round(frameCount.current / (elapsed.current / 1000));
        elapsed.current = 0;
        frameCount.current = 0;
      }

      if (!paused) {
        update(lastFrameTime.current);
        // setFrameCount(frameCount.current);
      }

      id = requestAnimationFrame(runFrame);
    }

    id = requestAnimationFrame(runFrame);

    return () => {
      cancelAnimationFrame(id);
    };
  }, [paused]);

  return [paused, setPaused, fps.current];
}

enum Direction {
  LEFT,
  RIGHT,
  UP,
  DOWN,
}

enum Sprite {
  SNAKE_HEAD,
  SNAKE_TAIL,
  FOOD,
}

type Position = [number, number];

function getOppositeDirection(direction: Direction): Direction {
  switch (direction) {
    case Direction.LEFT:
      return Direction.RIGHT;
    case Direction.RIGHT:
      return Direction.LEFT;
    case Direction.UP:
      return Direction.DOWN;
    case Direction.DOWN:
      return Direction.UP;
  }
}

abstract class Entity {
  protected id: number | undefined;

  public setId(id: number) {
    this.id = id;
  }

  public getId(): number {
    if (this.id === undefined) {
      throw new Error(
        "Attempted to access Entity id before it has been assigned an id",
      );
    }

    return this.id;
  }

  abstract update(diff: number, game: GameEngine): boolean;
}

abstract class PositionalEntity extends Entity {
  protected positionX = 0;
  protected positionY = 0;

  abstract sprites(): Generator<[Position, Sprite]>;

  public hasSamePosition(entity: PositionalEntity): boolean {
    return arePositionsEqual(this.getPosition(), entity.getPosition());
  }

  public getPosition(): Position {
    return [
      Math.floor(clampAndWrap(this.positionX / CELL_SIZE, 0, WIDTH)),
      Math.floor(clampAndWrap(this.positionY / CELL_SIZE, 0, HEIGHT)),
    ];
  }
}

class Food extends PositionalEntity {
  protected positionX = getRandomInt(0, WIDTH - 1) * CELL_SIZE;
  protected positionY = getRandomInt(0, HEIGHT - 1) * CELL_SIZE;
  private lifeTime = getRandomInt(10, 30) * 1_000;
  private elapsed = 0;

  *sprites(): Generator<[Position, Sprite]> {
    yield [this.getPosition(), Sprite.FOOD];
  }

  update(diff: number, game: GameEngine): boolean {
    this.elapsed += diff;

    if (this.elapsed >= this.lifeTime) {
      game.removeEntity(this);
      return true;
    }

    return false;
  }
}

class Snake extends PositionalEntity {
  private static SPEED_DELTA = 0.02;
  private static FOOD_RATE = 4_000;
  private static SPEED_CHANGE_RATE = 5_000;
  protected positionX = getRandomInt(0, WIDTH - 1) * CELL_SIZE;
  protected positionY = getRandomInt(0, HEIGHT - 1) * CELL_SIZE;
  private speed = 0.1;
  private direction = Direction.RIGHT;
  private queuedDirections: Direction[] = [];
  private tail: Position[] = [];
  private length = 5;
  private lastPosition: Position = this.getPosition();
  private foodElapsed = 0;
  private speedElapsed = 0;
  private dead = false;
  private score = 0;

  public update(diff: number, game: GameEngine): boolean {
    let needsUpdate = false;
    // Spawn food
    this.foodElapsed += diff;
    if (this.foodElapsed >= Snake.FOOD_RATE) {
      this.generateFood(game);
      this.foodElapsed = 0;
      needsUpdate = true;
    }

    // Increase speed
    this.speedElapsed += diff;
    if (this.speedElapsed >= Snake.SPEED_CHANGE_RATE) {
      this.increaseSpeed();
      this.speedElapsed = 0;
      needsUpdate = true;
    }

    // Immediately apply the oldest direction change
    if (this.hasQueuedDirectionChange()) {
      this.direction = this.queuedDirections[0];
    }

    const positionDelta = this.speed * diff;

    switch (this.direction) {
      case Direction.RIGHT:
        this.positionX += positionDelta;
        break;
      case Direction.LEFT:
        this.positionX -= positionDelta;
        break;
      case Direction.UP:
        this.positionY -= positionDelta;
        break;
      case Direction.DOWN:
        this.positionY += positionDelta;
        break;
    }

    const position = this.getPosition();

    // Detect if we have hit our tail
    if (this.tail.some((p) => arePositionsEqual(p, position))) {
      this.dead = true;
      needsUpdate = true;
    }

    // Detect if we have moved position
    if (!arePositionsEqual(position, this.lastPosition)) {
      // Only shift the direction change off the queue when we have moved positions
      if (this.hasQueuedDirectionChange()) {
        this.queuedDirections.shift();
      }

      // Add last position to the beginning of the tail
      this.tail.unshift(this.lastPosition);

      // Limit tail length to max length
      if (this.tail.length > this.length) {
        this.tail.length = this.length;
      }

      this.lastPosition = position;

      needsUpdate = true;
    }

    // Detect if we have eaten food
    for (const food of game.getEntitiesOfType(Food)) {
      if (this.hasSamePosition(food)) {
        game.removeEntity(food);
        this.length += 3;
        this.score += 1;
        needsUpdate = true;
      }
    }

    return needsUpdate;
  }

  public *sprites(): Generator<[Position, Sprite]> {
    yield [this.getPosition(), Sprite.SNAKE_HEAD];
    for (const position of this.tail) {
      yield [position, Sprite.SNAKE_TAIL];
    }
  }

  private hasQueuedDirectionChange(): boolean {
    return this.queuedDirections.length > 0;
  }

  public queueDirectionChange(direction: Direction) {
    const lastDirection = this.hasQueuedDirectionChange()
      ? this.queuedDirections[this.queuedDirections.length]
      : this.direction;

    if (direction === getOppositeDirection(lastDirection)) {
      return;
    }

    this.queuedDirections.push(direction);
  }

  private generateFood(game: GameEngine): void {
    const snakeBody = [this.getPosition(), ...this.tail];
    let food: Food;
    let foodPosition: Position;
    do {
      food = new Food();
      foodPosition = food.getPosition();
    } while (snakeBody.some((p) => arePositionsEqual(p, foodPosition)));
    game.addEntity(food);
  }

  public increaseSpeed() {
    this.speed += Snake.SPEED_DELTA;
  }

  public isDead(): boolean {
    return this.dead;
  }

  public getScore(): number {
    return this.score;
  }
}

class GameEngine {
  private id = 0;
  private entities: Entity[] = [];

  constructor(entities: Array<Entity> = []) {
    for (const entity of entities) {
      this.addEntity(entity);
    }
  }

  public addEntity(entity: Entity) {
    entity.setId(this.id);
    this.id += 1;
    this.entities.push(entity);
  }

  public removeEntity(entity: Entity) {
    this.entities = this.entities.filter((a) => a !== entity);
  }

  public getEntities(): Entity[] {
    return this.entities;
  }

  public getEntitiesOfType<T extends typeof Entity>(
    type: T,
  ): InstanceType<T>[] {
    return this.entities.filter(
      (entity): entity is InstanceType<T> => entity instanceof type,
    );
  }

  public getFirstEntityOfType<T extends typeof Entity>(
    type: T,
  ): InstanceType<T> | undefined {
    return this.entities.find(
      (entity): entity is InstanceType<T> => entity instanceof type,
    );
  }

  public update(diff: number): boolean {
    let needsUpdate = false;

    for (const entity of this.entities) {
      if (entity.update(diff, this)) {
        needsUpdate = true;
      }
    }

    return needsUpdate;
  }
}

function* generateSprites(
  game: GameEngine,
): Generator<[Position, string, Sprite]> {
  for (const entity of game.getEntitiesOfType(PositionalEntity)) {
    const entityId = entity.getId();
    let index = 0;
    for (const [position, sprite] of entity.sprites()) {
      yield [position, `${entityId}-${index}`, sprite];
      index++;
    }
  }
}

function getSpriteClassName(sprite: Sprite): string {
  switch (sprite) {
    case Sprite.SNAKE_HEAD:
      return "sprite-snake-head";
    case Sprite.SNAKE_TAIL:
      return "sprite-snake-tail";
    case Sprite.FOOD:
      return "sprite-food";
  }
}

function SnakeGame({ game }: { game: GameEngine }) {
  const [_, triggerRender] = useState({});
  const [paused, setPaused, fps] = useGameLoop((lastFrameDiff) => {
    if (game.update(lastFrameDiff)) {
      triggerRender({});
    }
  });

  const snake = game.getFirstEntityOfType(Snake);

  useEffect(() => {
    if (snake && snake.isDead()) {
      setPaused(true);
    }
  }, [snake, snake?.isDead()]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowUp":
          snake?.queueDirectionChange(Direction.UP);
          break;
        case "ArrowRight":
          snake?.queueDirectionChange(Direction.RIGHT);
          break;
        case "ArrowDown":
          snake?.queueDirectionChange(Direction.DOWN);
          break;
        case "ArrowLeft":
          snake?.queueDirectionChange(Direction.LEFT);
          break;
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [snake]);

  const reset = useCallback(() => {
    for (const entity of game.getEntities()) {
      game.removeEntity(entity);
    }
    game.addEntity(new Snake());
    setPaused(false);
  }, [game]);

  const togglePause = useCallback(() => setPaused((paused) => !paused), []);

  return (
    <>
      <div className="menu">
        {snake === undefined || snake.isDead() ? (
          <button onClick={reset}>Start</button>
        ) : (
          <button onClick={togglePause}>{paused ? "Resume" : "Pause"}</button>
        )}
        <div>{snake?.getScore() ?? 0}</div>
        <div>{fps}</div>
      </div>
      <div
        className="grid"
        style={{ width: CELL_SIZE * WIDTH, height: CELL_SIZE * HEIGHT }}
      >
        {Array.from(generateSprites(game)).map(([[x, y], id, sprite]) => (
          <div
            key={id}
            className={`cell ${getSpriteClassName(sprite)}`}
            style={{
              width: CELL_SIZE,
              height: CELL_SIZE,
              transform: `translate(${x * CELL_SIZE}px, ${y * CELL_SIZE}px)`,
            }}
          />
        ))}
      </div>
    </>
  );
}

function App() {
  const game = new GameEngine();

  return <SnakeGame game={game} />;
}

export default App;
