import { INITIAL_LETTERS } from './data.js';

class State {
  constructor() {
    this.currentHall = 'hall1'; 
    this.selectedTeacherId = null; 
    this.letters = [...INITIAL_LETTERS];
    this.starCount = 380 + INITIAL_LETTERS.length;
    
    this.milkywayStars = [
      { name: "홍길동", text: "고결한 가르침을 마음에 영원히 기억하겠습니다." },
      { name: "교사 임하진", text: "더는 외롭지 않은 교실을 만들기 위해 끝까지 연대하겠습니다." },
      { name: "시민 박선경", text: "선생님의 다정했던 미소가 하늘의 고운 별이 되었기를 기원합니다." },
      { name: "학부모 윤영호", text: "아이들을 극진히 보살펴주신 눈물겨운 은혜에 엎드려 감사드립니다." },
      { name: "동료교사 최민우", text: "영서야, 네가 못다 피운 교단의 꽃 내가 대신 끝까지 돌볼게." },
      { name: "시민 이소율", text: "그 아침 나라에서는 부디 아무 근심 없이 편히 웃어주세요." },
      { name: "참배객 김은식", text: "기억하겠습니다. 잊지 않고 늘 마음 깊은 곳에 간직할게요." },
      { name: "강현주 선생님", text: "교직의 길에서 외로울 때 늘 선생님의 이야기를 되뇌며 용기를 얻습니다." },
      { name: "시민 서원태", text: "두 번째 이별은 결코 없을 것입니다. 세상 모든 참된 희생이 존중받기를." },
      { name: "학부모 정현진", text: "우리 아이들에게 베풀어 주셨던 무한한 사랑, 하늘의 고운 빛으로 기억됩니다." }
    ];
    this.listeners = [];
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notify() {
    this.listeners.forEach(l => {
      try {
        l();
      } catch (err) {
        console.error("Listener error", err);
      }
    });
  }

  switchHall(hall) {
    this.currentHall = hall;
    this.selectedTeacherId = null; 
    this.notify();
  }

  selectTeacher(teacherId) {
    this.selectedTeacherId = teacherId;
    this.notify();
  }

  addLetter(letter) {
    this.letters.unshift(letter);
    this.notify();
  }

  addStar(star) {
    this.milkywayStars.push(star);
    this.starCount++;
    this.notify();
  }
}

export const store = new State();
