import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';
import { GoalPreset, PlanRequest, PlanResponse } from './models';

@Injectable({ providedIn: 'root' })
export class PlannerService {
  private readonly base = environment.apiUrl;

  constructor(private http: HttpClient) {}

  presets(): Observable<GoalPreset[]> {
    return this.http.get<GoalPreset[]>(`${this.base}/presets`);
  }

  plan(req: PlanRequest): Observable<PlanResponse> {
    return this.http.post<PlanResponse>(`${this.base}/plan`, req);
  }
}
